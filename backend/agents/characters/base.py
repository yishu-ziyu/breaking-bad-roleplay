from abc import ABC, abstractmethod
import json
import logging
import re
from typing import Sequence

from agents.provider import ProviderFacade, ModelResult
from agents.tools import (
    Tool,
    ToolResult,
    ToolRegistry,
    ToolExecutor,
    tool_result_messages,
    assistant_message_with_tools,
)

logger = logging.getLogger(__name__)

# Max tool-calling rounds per respond_structured call (DEC-0001 / ARCH-DESIGN).
MAX_TOOL_ROUNDS = 4

# Prompt appended when structured output is requested so the LLM returns
# a JSON envelope alongside the in-character reply.
STRUCTURED_OUTPUT_PROMPT = """\

Respond ONLY with a single JSON object (no markdown fences, no extra text):

{
  "reply_text": "<the character's in-character reply>",
  "emotion_state": "<one of: calm, tense, angry, fearful, manipulative, guilty, resigned, desperate>",
  "gif_search_query": "<English visual emotion search phrase, e.g. 'walter white angry determined'>",
  "thinking": "<brief inner monologue or reasoning (1-3 sentences)>",
  "tool_executed": "<tool name if a tool was called, otherwise null>",
  "tool_log": "<tool execution result or null>"
}

RULES:
- reply_text must be the character's spoken reply only (no narration).
- emotion_state must be exactly one of: calm, tense, angry, fearful, manipulative, guilty, resigned, desperate.
- gif_search_query must be in English and descriptive enough for image search.
- thinking reveals what the character is really thinking beneath their words.
- tool_executed and tool_log describe any fictional in-world tool the character used (e.g. "disposal service", "lab inventory check"), or null if none.
- Do NOT include any fields outside this schema.
"""


def _extract_structured(text: str) -> dict:
    """
    Try to parse a character response that may contain a JSON envelope.

    Returns a dict with keys: reply_text, emotion_state, gif_search_query,
    thinking, tool_executed, tool_log.  Falls back to plain-text reply if
    no JSON is found.
    """
    # Strip markdown fences if present
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    raw = fenced.group(1) if fenced else text.strip()

    # Find the outer JSON object
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            return {
                "reply_text": data.get("reply_text", text),
                "emotion_state": data.get("emotion_state"),
                "gif_search_query": data.get("gif_search_query"),
                "thinking": data.get("thinking"),
                "tool_executed": data.get("tool_executed"),
                "tool_log": data.get("tool_log"),
            }
        except (json.JSONDecodeError, TypeError):
            pass

    # No JSON found — return the raw text as the reply
    return {
        "reply_text": text,
        "emotion_state": None,
        "gif_search_query": None,
        "thinking": None,
        "tool_executed": None,
        "tool_log": None,
    }


class BaseCharacter(ABC):
    """
    Abstract base for all roleplay character agents.

    Each concrete character supplies its own system prompt and
    optional personality tweaks via `respond()`.
    """

    def __init__(self, name: str, provider: ProviderFacade):
        self.name = name
        self.provider = provider
        self._tool_registry = ToolRegistry()
        for _name, _fn in self.tool_executors.items():
            self._tool_registry.register(_name, _fn)
        self._last_tool_results: list[tuple[str, ToolResult]] = []

    @abstractmethod
    def system_prompt(self) -> str:
        """Return the character's system prompt."""

    @property
    def tools(self) -> list[Tool]:
        """Tools this character can invoke via native function calling. Override in subclasses."""
        return []

    @property
    def tool_executors(self) -> dict[str, ToolExecutor]:
        """name -> async executor, matching ``tools``. Override in subclasses."""
        return {}

    async def respond_structured(
        self,
        context: Sequence[dict],
        user_message: str,
        model_route: str = "stepfun/step-3.7-flash",
        voice_example: str | None = None,
        dossier_context: str | None = None,
    ) -> dict:
        """
        Generate an in-character reply with structured metadata.

        Appends a JSON-output instruction to the system prompt and parses
        the LLM response into a dict with keys:
          reply_text, emotion_state, gif_search_query, thinking,
          tool_executed, tool_log

        When ``dossier_context`` is provided (relationship state from the
        DB), it is injected as a RELATIONSHIP CONTEXT block so the
        character is aware of the player's history with them.
        """
        system_prompt = self.system_prompt()
        extras: list[str] = []
        if dossier_context:
            extras.append(dossier_context)
        if voice_example:
            extras.append(
                "VOICE ANCHOR:\n"
                "Match the cadence and relationship pressure of this reference "
                "speaking style when rewriting the scene below. Keep the scene facts; "
                "let the relationship pressure guide register and word choice.\n"
                f"{voice_example}"
            )
        if extras:
            system_prompt = system_prompt + "\n\n" + "\n\n".join(extras)
        # Build messages with structured-output instruction
        messages: list[dict] = [
            {"role": "system", "content": system_prompt + STRUCTURED_OUTPUT_PROMPT},
        ]
        messages.extend(context)
        messages.append({"role": "user", "content": user_message})

        try:
            if self.tools:
                result = await self._run_with_tools(messages, model_route)
                parsed = _extract_structured(result.content)
                if self._last_tool_results:
                    _names = [n for n, _ in self._last_tool_results]
                    _logs = [tr.content for _, tr in self._last_tool_results]
                    parsed["tool_executed"] = (
                        ", ".join(_names) if len(_names) > 1 else (_names[0] if _names else None)
                    )
                    parsed["tool_log"] = (
                        " | ".join(_logs) if len(_logs) > 1 else (_logs[0] if _logs else None)
                    )
                else:
                    # No real tool ran — clear any LLM-fabricated tool fields
                    # (DEC-0001: tool evidence must come from real execution,
                    # not from the model's imagination).
                    parsed["tool_executed"] = None
                    parsed["tool_log"] = None
                return parsed
            raw = await self.provider.call_model(messages, model_route)
        except Exception:
            logger.exception(
                "%s LLM call failed, using fallback reply",
                self.__class__.__name__,
            )
            raw = json.dumps({
                "reply_text": "...",
                "emotion_state": "calm",
                "gif_search_query": None,
                "thinking": None,
                "tool_executed": None,
                "tool_log": None,
            })

        return _extract_structured(raw)

    async def _run_with_tools(self, messages: list[dict], model_route: str) -> ModelResult:
        """Native function-calling loop: model -> tool_calls -> execute -> feed back.

        Runs at most ``MAX_TOOL_ROUNDS`` rounds. The REAL tool results are stored
        on ``self._last_tool_results`` so the caller can overwrite the
        ``tool_executed``/``tool_log`` fields with grounded output (DEC-0001).
        """
        provider_prefix = model_route.split("/", 1)[0]
        self._last_tool_results = []
        result = await self.provider.call_model_with_tools(messages, model_route, self.tools)
        rounds = 0
        while result.tool_calls and rounds < MAX_TOOL_ROUNDS:
            # Both Anthropic and OpenAI require the assistant turn that
            # *requested* the tools to appear before the tool_result turn.
            # The Facade normalises the response into a ModelResult, so we
            # reconstruct the assistant turn here (DEC-0001 / ARCH-DESIGN).
            messages.append(assistant_message_with_tools(provider_prefix, result))
            executed: list[ToolResult] = []
            for tc in result.tool_calls:
                tr = await self._tool_registry.execute(tc.name, tc.arguments)
                self._last_tool_results.append((tc.name, tr))
                executed.append(tr)
            # Anthropic-compatible providers require ALL tool_result blocks for
            # one assistant turn to live in a SINGLE user message. OpenAI wants
            # one role=tool message per call. tool_result_messages handles both.
            messages.extend(tool_result_messages(provider_prefix, result.tool_calls, executed))
            result = await self.provider.call_model_with_tools(messages, model_route, self.tools)
            rounds += 1
        if result.tool_calls:
            # Hit MAX_TOOL_ROUNDS while the model still wants more tools.
            # Force a final completion WITHOUT tools so the user never sees
            # an empty envelope (DEC-0001 hardens the loop against runaway
            # tool requests). An empty tool set makes providers fall back to
            # plain text generation.
            result = await self.provider.call_model_with_tools(messages, model_route, [])
        return result
