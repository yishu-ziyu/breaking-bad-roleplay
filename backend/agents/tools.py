"""Native function-calling primitives for ABQ Roleplay Lab.

Provider-agnostic tool representation + a lightweight registry + cross-provider
schema translation. Kept dependency-free (stdlib + pydantic optional) so it can
be imported by the FastAPI backend without pulling in an agent framework.

See docs/DEC-0001-function-calling.md and docs/ARCH-DESIGN-function-calling.md.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


@dataclass
class Tool:
    """A single function-calling tool, provider-agnostic.

    ``parameters_json_schema`` is a JSON Schema dict used for both Anthropic
    (``input_schema``) and OpenAI (``parameters``) wire formats.
    """

    name: str
    description: str
    parameters_json_schema: dict


@dataclass
class ToolCall:
    """A model-requested tool invocation, normalised across providers."""

    id: str
    name: str
    arguments: dict


@dataclass
class ToolResult:
    """The result returned to the model after executing a ``ToolCall``."""

    content: str
    is_error: bool = False


# Executor signature: receives parsed arguments, returns a ToolResult.
ToolExecutor = Callable[[dict], Awaitable[ToolResult]]


class ToolRegistry:
    """Maps tool names to async executors and runs them.

    Characters register their tools (name -> executor) at construction time.
    Unknown or failing tools degrade to an error ToolResult instead of raising,
    so a bad tool never crashes a beat.
    """

    def __init__(self) -> None:
        self._executors: dict[str, ToolExecutor] = {}

    def register(self, name: str, executor: ToolExecutor) -> None:
        self._executors[name] = executor

    def register_tool(self, tool: Tool, executor: ToolExecutor) -> None:
        self.register(tool.name, executor)

    async def execute(self, name: str, arguments: dict) -> ToolResult:
        fn = self._executors.get(name)
        if fn is None:
            return ToolResult(content=f"unknown tool: {name}", is_error=True)
        try:
            return await fn(arguments or {})
        except Exception as exc:  # noqa: BLE001 - surface as tool error, never crash beat
            logger.warning("Tool %s failed: %s", name, exc)
            return ToolResult(content=f"tool error: {exc}", is_error=True)


# ---------------------------------------------------------------------------
# Cross-provider schema translation
# ---------------------------------------------------------------------------

def translate_tools_to_anthropic(tools: list[Tool]) -> list[dict]:
    """Provider-agnostic Tool -> Anthropic `/v1/messages` `tools` shape."""
    return [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": t.parameters_json_schema,
        }
        for t in tools
    ]


def translate_tools_to_openai(tools: list[Tool]) -> list[dict]:
    """Provider-agnostic Tool -> OpenAI `tools` shape."""
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters_json_schema,
            },
        }
        for t in tools
    ]


def parse_tool_calls_anthropic(content_blocks: list[dict]) -> list[ToolCall]:
    """Extract ToolCalls from an Anthropic response's ``content`` blocks."""
    calls: list[ToolCall] = []
    for block in content_blocks:
        if not isinstance(block, dict):
            continue
        if block.get("type") != "tool_use":
            continue
        raw_input = block.get("input", {})
        if not isinstance(raw_input, dict):
            raw_input = {}
        calls.append(
            ToolCall(
                id=str(block.get("id", "")),
                name=str(block.get("name", "")),
                arguments=raw_input,
            )
        )
    return calls


def parse_tool_calls_openai(message: dict) -> list[ToolCall]:
    """Extract ToolCalls from an OpenAI `message.tool_calls` list.

    OpenAI returns ``function.arguments`` as a JSON *string*; this parses it.
    """
    raw_calls = (message or {}).get("tool_calls") or []
    calls: list[ToolCall] = []
    for tc in raw_calls:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function", {}) or {}
        name = fn.get("name", "")
        arguments: dict = {}
        raw_args = fn.get("arguments")
        if isinstance(raw_args, str) and raw_args.strip():
            try:
                parsed = json.loads(raw_args)
                if isinstance(parsed, dict):
                    arguments = parsed
            except json.JSONDecodeError:
                arguments = {}
        elif isinstance(raw_args, dict):
            arguments = raw_args
        calls.append(
            ToolCall(id=str(tc.get("id", "")), name=str(name), arguments=arguments)
        )
    return calls


def tool_result_message(provider_prefix: str, tool_call: "ToolCall", tool_result: "ToolResult") -> dict:
    """Build the provider-correct assistant->model message carrying a tool result.

    Anthropic expects a ``user`` turn with a ``tool_result`` block; OpenAI
    expects a ``tool`` role message. ``provider_prefix`` is the part before
    ``/`` in the model_route (e.g. ``minimax``, ``stepfun``, ``cliproxy``).
    """
    return tool_result_messages(provider_prefix, [tool_call], [tool_result])[0]


def tool_result_messages(
    provider_prefix: str, tool_calls: list["ToolCall"], tool_results: list["ToolResult"]
) -> list[dict]:
    """Build the provider-correct messages carrying one round of tool results.

    ``tool_calls`` and ``tool_results`` are 1:1 parallel lists from the same
    assistant turn. The message shape differs by provider:

    - **OpenAI (stepfun/openai):** one ``{"role": "tool"}`` message per call,
      each keyed by ``tool_call_id``. This is correct and required by OpenAI.
    - **Anthropic-compatible (minimax/cliproxy):** ALL tool_result blocks from
      one assistant turn MUST live in EXACTLY ONE ``user`` message, immediately
      following it. Emitting N separate ``user`` messages (one per call) is an
      invalid conversation shape and makes the provider reject the request.

    ``ToolResult.is_error`` is forwarded as the native ``is_error`` field on the
    Anthropic ``tool_result`` block; OpenAI has no such field, so it is dropped
    there (no crash). Surfacing failures lets the model recover instead of
    proceeding on bad data.
    """
    n = min(len(tool_calls), len(tool_results))
    if provider_prefix in ("stepfun", "openai"):
        out: list[dict] = []
        for i in range(n):
            out.append({
                "role": "tool",
                "tool_call_id": tool_calls[i].id,
                "content": tool_results[i].content,
            })
        return out
    # Anthropic-compatible (minimax, cliproxy): fold every block into ONE user turn.
    blocks = []
    for i in range(n):
        blocks.append({
            "type": "tool_result",
            "tool_use_id": tool_calls[i].id,
            "content": tool_results[i].content,
            "is_error": tool_results[i].is_error,
        })
    return [{"role": "user", "content": blocks}]


def assistant_message_with_tools(provider_prefix: str, result: "ModelResult") -> dict:
    """Rebuild the assistant turn that *requested* the tools.

    Both Anthropic and OpenAI require the assistant message carrying the
    tool invocation to appear in the conversation *before* the tool_result
    turn. The Facade normalises the model response into a ``ModelResult``
    (discarding the raw wire blocks), so the loop must reconstruct the
    assistant turn from it. ``provider_prefix`` is the part before ``/`` in
    the model_route.
    """
    if provider_prefix in ("stepfun", "openai"):
        return {
            "role": "assistant",
            "content": result.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": json.dumps(tc.arguments or {}),
                    },
                }
                for tc in (result.tool_calls or [])
            ],
        }
    # Anthropic-compatible (minimax, cliproxy)
    blocks: list[dict] = []
    if result.content:
        blocks.append({"type": "text", "text": result.content})
    for tc in (result.tool_calls or []):
        blocks.append(
            {
                "type": "tool_use",
                "id": tc.id,
                "name": tc.name,
                "input": tc.arguments or {},
            }
        )
    return {"role": "assistant", "content": blocks}
