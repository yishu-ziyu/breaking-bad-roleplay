"""TDD: production Agent Harness (ReAct AgentLoop + circuit breaker + loop detect)."""
from __future__ import annotations

import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from unittest.mock import AsyncMock

import pytest

from agents.harness import (
    AgentLoop,
    AgentRunResult,
    CircuitBreaker,
    detect_repeated_tool_loop,
    with_retry,
)
from agents.harness.correct import tool_call_signature
from agents.provider import ModelResult
from agents.tools import Tool, ToolCall, ToolRegistry, ToolResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _echo_tool() -> Tool:
    return Tool(
        name="echo",
        description="Echo arguments back",
        parameters_json_schema={
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    )


def _registry_with_echo() -> ToolRegistry:
    reg = ToolRegistry()

    async def _echo(args: dict) -> ToolResult:
        return ToolResult(content=f"echo:{args.get('text', '')}")

    reg.register("echo", _echo)
    return reg


def _tool_call(name: str = "echo", text: str = "hi", call_id: str = "tc_1") -> ToolCall:
    return ToolCall(id=call_id, name=name, arguments={"text": text})


# ---------------------------------------------------------------------------
# Fake provider: tool_use then final text
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_agent_loop_tool_then_final():
    """Provider returns tool_use first, then final text after tool execution."""
    calls = {"n": 0}

    async def fake_with_tools(messages, model_route, tools):
        calls["n"] += 1
        if calls["n"] == 1:
            return ModelResult(
                content="I should echo that",
                tool_calls=[_tool_call(text="lab")],
                stop_reason="tool_use",
            )
        return ModelResult(
            content="Done: echo:lab",
            tool_calls=[],
            stop_reason="end_turn",
        )

    provider = AsyncMock()
    provider.call_model_with_tools = AsyncMock(side_effect=fake_with_tools)

    loop = AgentLoop(
        provider=provider,
        tools=[_echo_tool()],
        registry=_registry_with_echo(),
        max_iterations=8,
        model_route="minimax/MiniMax-M3",
        system_prompt="You are a test agent.",
    )
    result = await loop.run("run echo")

    assert isinstance(result, AgentRunResult)
    assert result.stopped_reason == "completed"
    assert result.final_text == "Done: echo:lab"
    assert result.iterations == 2
    kinds = [s.kind for s in result.steps]
    assert "tool_call" in kinds
    assert "tool_result" in kinds
    assert "final" in kinds
    tool_results = [s for s in result.steps if s.kind == "tool_result"]
    assert tool_results[0].tool_result == "echo:lab"
    assert calls["n"] == 2


# ---------------------------------------------------------------------------
# Circuit breaker
# ---------------------------------------------------------------------------

def test_circuit_breaker_opens_after_failures():
    cb = CircuitBreaker(failure_threshold=3, reset_timeout_s=60)
    assert cb.is_open is False
    cb.record_failure()
    cb.record_failure()
    assert cb.is_open is False
    cb.record_failure()
    assert cb.is_open is True
    cb.record_success()
    assert cb.is_open is False


@pytest.mark.asyncio
async def test_agent_loop_aborts_when_circuit_open():
    cb = CircuitBreaker(failure_threshold=1, reset_timeout_s=60)
    cb.record_failure()
    assert cb.is_open

    provider = AsyncMock()
    provider.call_model_with_tools = AsyncMock(
        return_value=ModelResult(content="should not run", tool_calls=[], stop_reason="end_turn")
    )
    loop = AgentLoop(
        provider=provider,
        tools=[],
        registry=ToolRegistry(),
        model_route="stepfun/step-3.7-flash",
        circuit=cb,
    )
    result = await loop.run("hello")
    assert result.stopped_reason == "circuit_open"
    assert result.iterations == 0
    provider.call_model_with_tools.assert_not_called()


# ---------------------------------------------------------------------------
# Max iterations forces final without tools
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_max_iterations_forces_final():
    """When model keeps requesting tools past max_iterations, force no-tools call."""
    call_log: list[bool] = []

    async def always_tools(messages, model_route, tools):
        # Track whether tools were offered this call
        call_log.append(bool(tools))
        if tools:
            n = sum(1 for x in call_log if x)
            return ModelResult(
                content="",
                tool_calls=[_tool_call(text=f"n{n}", call_id=f"tc_{n}")],
                stop_reason="tool_use",
            )
        return ModelResult(
            content="forced final",
            tool_calls=[],
            stop_reason="end_turn",
        )

    reg = ToolRegistry()

    async def _echo(args: dict) -> ToolResult:
        return ToolResult(content=f"echo:{args.get('text', '')}")

    reg.register("echo", _echo)

    provider = AsyncMock()
    provider.call_model_with_tools = AsyncMock(side_effect=always_tools)

    loop = AgentLoop(
        provider=provider,
        tools=[_echo_tool()],
        registry=reg,
        max_iterations=2,
        model_route="minimax/MiniMax-M3",
        system_prompt="test",
    )

    result = await loop.run("keep going")
    assert result.stopped_reason == "max_iterations"
    assert result.final_text == "forced final"
    assert result.iterations == 2
    # Last call must have been with empty tools list.
    assert call_log[-1] is False
    assert any(s.kind == "final" and s.content == "forced final" for s in result.steps)


# ---------------------------------------------------------------------------
# Repeated tool loop detection
# ---------------------------------------------------------------------------

def test_detect_repeated_tool_loop():
    assert detect_repeated_tool_loop([]) is False
    assert detect_repeated_tool_loop(["a", "a"]) is False  # window default 3
    assert detect_repeated_tool_loop(["a", "a", "a"]) is True
    assert detect_repeated_tool_loop(["a", "b", "a"]) is False
    assert detect_repeated_tool_loop(["x", "x"], window=2) is True
    assert detect_repeated_tool_loop(["", "", ""], window=3) is False


def test_tool_call_signature_stable():
    s1 = tool_call_signature("echo", {"b": 2, "a": 1})
    s2 = tool_call_signature("echo", {"a": 1, "b": 2})
    assert s1 == s2
    assert s1.startswith("echo:")


@pytest.mark.asyncio
async def test_agent_loop_stops_on_repeated_tool_signature():
    """Identical tool signatures for window=3 rounds → loop_detected stop."""
    async def always_same(messages, model_route, tools):
        return ModelResult(
            content="",
            tool_calls=[_tool_call(text="same", call_id="tc_same")],
            stop_reason="tool_use",
        )

    provider = AsyncMock()
    provider.call_model_with_tools = AsyncMock(side_effect=always_same)

    loop = AgentLoop(
        provider=provider,
        tools=[_echo_tool()],
        registry=_registry_with_echo(),
        max_iterations=8,
        model_route="minimax/MiniMax-M3",
        system_prompt="test",
    )

    result = await loop.run("loop me")
    assert result.stopped_reason == "loop_detected"
    assert any(s.kind == "error" for s in result.steps)
    assert result.iterations == 3  # three identical tool rounds before break


# ---------------------------------------------------------------------------
# with_retry
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_with_retry_eventually_succeeds():
    n = {"i": 0}

    async def flaky():
        n["i"] += 1
        if n["i"] < 3:
            raise RuntimeError("transient")
        return "ok"

    out = await with_retry(flaky, max_attempts=3, backoff_s=0.0)
    assert out == "ok"
    assert n["i"] == 3


@pytest.mark.asyncio
async def test_with_retry_raises_after_exhaustion():
    async def always_fail():
        raise ValueError("nope")

    with pytest.raises(ValueError, match="nope"):
        await with_retry(always_fail, max_attempts=2, backoff_s=0.0)


# ---------------------------------------------------------------------------
# Fallback when call_model_with_tools is missing
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fallback_to_call_model_without_tools_api():
    class PlainProvider:
        async def call_model(self, messages, model_route):
            return "plain reply"

    loop = AgentLoop(
        provider=PlainProvider(),
        tools=[],
        registry=ToolRegistry(),
        model_route="stepfun/step-3.7-flash",
        system_prompt="sys",
    )
    result = await loop.run("hi")
    assert result.stopped_reason == "completed"
    assert result.final_text == "plain reply"
