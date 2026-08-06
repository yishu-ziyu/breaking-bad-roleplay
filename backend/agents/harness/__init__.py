"""Production Agent Harness for ABQ Roleplay Lab.

Maps to ai-agent-book: Agent = Model + Harness
Harness = Context + Tools + Constrain + Verify + Correct
(+ trajectory, evolution, multi-agent).
"""

from agents.harness.correct import (
    CircuitBreaker,
    detect_repeated_tool_loop,
    tool_call_signature,
    with_retry,
)
from agents.harness.loop import AgentLoop, AgentRunResult, AgentStep

__all__ = [
    "AgentLoop",
    "AgentRunResult",
    "AgentStep",
    "CircuitBreaker",
    "detect_repeated_tool_loop",
    "tool_call_signature",
    "with_retry",
]


def __getattr__(name: str):
    # Lazy exports that pull heavier modules (service/orchestrator).
    if name in {"AgentHarnessService", "get_harness_service", "capabilities_payload"}:
        from agents.harness import service as _service

        return getattr(_service, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
