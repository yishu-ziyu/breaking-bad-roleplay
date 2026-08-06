"""ReAct AgentLoop (ai-agent-book ch1/ch2).

Core while-loop: model → tool_calls → execute → feed back → until final.
Production caps: max_iterations, circuit breaker, repeated-tool detection.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from agents.harness.correct import (
    CircuitBreaker,
    detect_repeated_tool_loop,
    tool_call_signature,
)
from agents.tools import (
    Tool,
    ToolRegistry,
    assistant_message_with_tools,
    tool_result_messages,
)

logger = logging.getLogger(__name__)


@dataclass
class AgentStep:
    kind: str  # thought | tool_call | tool_result | final | error
    content: str = ""
    tool_name: str | None = None
    tool_args: dict[str, Any] | None = None
    tool_result: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentRunResult:
    final_text: str
    steps: list[AgentStep] = field(default_factory=list)
    iterations: int = 0
    stopped_reason: str = "completed"  # completed|max_iterations|circuit_open|error|guardrail|loop_detected
    trajectory_id: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)


class AgentLoop:
    def __init__(
        self,
        provider: Any,
        tools: list[Tool],
        registry: ToolRegistry,
        *,
        max_iterations: int = 8,
        model_route: str = "stepfun/step-3.7-flash",
        system_prompt: str = "You are a helpful agent. Use tools when needed.",
        circuit: CircuitBreaker | None = None,
        constraint_checker: Any | None = None,
    ) -> None:
        self.provider = provider
        self.tools = tools
        self.registry = registry
        self.max_iterations = max(1, max_iterations)
        self.model_route = model_route
        self.system_prompt = system_prompt
        self.circuit = circuit or CircuitBreaker()
        self.constraint_checker = constraint_checker  # optional: (name, args) -> (ok, reason)

    async def run(
        self,
        user_message: str,
        messages: list[dict] | None = None,
        *,
        trajectory_id: str | None = None,
    ) -> AgentRunResult:
        steps: list[AgentStep] = []
        provider_prefix = (self.model_route or "openai").split("/", 1)[0]

        if messages is None:
            messages = [
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": user_message},
            ]
        else:
            messages = list(messages)

        signatures: list[str] = []
        iterations = 0

        if self.circuit.is_open:
            return AgentRunResult(
                final_text="Circuit open — agent paused after repeated failures.",
                steps=steps,
                iterations=0,
                stopped_reason="circuit_open",
                trajectory_id=trajectory_id,
            )

        while iterations < self.max_iterations:
            iterations += 1
            try:
                result = await self._call_model(messages)
            except Exception as exc:  # noqa: BLE001
                self.circuit.record_failure()
                steps.append(AgentStep(kind="error", content=str(exc)))
                return AgentRunResult(
                    final_text=f"Model call failed: {exc}",
                    steps=steps,
                    iterations=iterations,
                    stopped_reason="error",
                    trajectory_id=trajectory_id,
                )

            self.circuit.record_success()
            content = (getattr(result, "content", None) or "") if result is not None else ""
            tool_calls = list(getattr(result, "tool_calls", None) or [])

            if content and not tool_calls:
                steps.append(AgentStep(kind="final", content=content))
                return AgentRunResult(
                    final_text=content,
                    steps=steps,
                    iterations=iterations,
                    stopped_reason="completed",
                    trajectory_id=trajectory_id,
                )

            if content:
                steps.append(AgentStep(kind="thought", content=content))

            if not tool_calls:
                # Empty content, no tools — treat as completed empty
                steps.append(AgentStep(kind="final", content=content or ""))
                return AgentRunResult(
                    final_text=content or "",
                    steps=steps,
                    iterations=iterations,
                    stopped_reason="completed",
                    trajectory_id=trajectory_id,
                )

            # Append assistant turn with tool requests
            messages.append(assistant_message_with_tools(provider_prefix, result))

            executed_results = []
            for tc in tool_calls:
                name = getattr(tc, "name", "") or ""
                args = getattr(tc, "arguments", None) or {}
                sig = tool_call_signature(name, args)
                signatures.append(sig)
                steps.append(
                    AgentStep(
                        kind="tool_call",
                        content=sig,
                        tool_name=name,
                        tool_args=dict(args),
                    )
                )

                if self.constraint_checker is not None:
                    ok, reason = self.constraint_checker(name, args)
                    if not ok:
                        from agents.tools import ToolResult

                        tr = ToolResult(content=f"blocked: {reason}", is_error=True)
                        executed_results.append(tr)
                        steps.append(
                            AgentStep(
                                kind="tool_result",
                                content=tr.content,
                                tool_name=name,
                                tool_result=tr.content,
                                meta={"blocked": True},
                            )
                        )
                        continue

                tr = await self.registry.execute(name, args)
                executed_results.append(tr)
                steps.append(
                    AgentStep(
                        kind="tool_result",
                        content=tr.content,
                        tool_name=name,
                        tool_result=tr.content,
                        meta={"is_error": tr.is_error},
                    )
                )

            messages.extend(
                tool_result_messages(provider_prefix, tool_calls, executed_results)
            )

            if detect_repeated_tool_loop(signatures, window=3):
                steps.append(
                    AgentStep(
                        kind="error",
                        content="Repeated identical tool calls detected; breaking loop.",
                    )
                )
                return AgentRunResult(
                    final_text=content
                    or "Stopped: repeated tool loop. Please rephrase the request.",
                    steps=steps,
                    iterations=iterations,
                    stopped_reason="loop_detected",
                    trajectory_id=trajectory_id,
                )

        # Max iterations: force final without tools
        try:
            messages.append(
                {
                    "role": "user",
                    "content": "Stop using tools. Give your best final answer now.",
                }
            )
            result = await self._call_model(messages, allow_tools=False)
            content = (getattr(result, "content", None) or "") if result else ""
        except Exception as exc:  # noqa: BLE001
            content = f"(max iterations; final call failed: {exc})"
        steps.append(AgentStep(kind="final", content=content))
        return AgentRunResult(
            final_text=content,
            steps=steps,
            iterations=iterations,
            stopped_reason="max_iterations",
            trajectory_id=trajectory_id,
        )

    async def _call_model(self, messages: list[dict], *, allow_tools: bool = True) -> Any:
        tools = self.tools if allow_tools else []
        if hasattr(self.provider, "call_model_with_tools"):
            return await self.provider.call_model_with_tools(
                messages, self.model_route, tools
            )
        # Fallback: text-only
        if hasattr(self.provider, "call_model"):
            text = await self.provider.call_model(messages, self.model_route)
            from agents.provider import ModelResult

            return ModelResult(content=str(text or ""), tool_calls=[], stop_reason="end_turn")
        raise RuntimeError("provider has no call_model_with_tools or call_model")
