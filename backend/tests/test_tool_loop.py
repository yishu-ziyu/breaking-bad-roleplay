"""TDD: the native function-calling loop in BaseCharacter.respond_structured.

A fake provider returns a tool_use on the first call, then a final structured
reply on the second. We assert the loop executed the tool and grounded the
``tool_executed``/``tool_log`` fields with the REAL result.
"""
import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from types import SimpleNamespace

from agents.provider import ProviderFacade, ModelResult
from agents.tools import ToolCall
from agents.characters import WalterWhite


def _facade() -> ProviderFacade:
    return ProviderFacade(
        settings=SimpleNamespace(
            minimax_api_key="k",
            stepfun_api_key="k",
            cli_proxy_base_url="http://x",
            cli_proxy_api_key="k",
            cli_proxy_default_model="m",
        )
    )


async def test_tool_loop_runs_and_grounds_envelope(monkeypatch):
    c = WalterWhite(_facade())
    calls = {"n": 0, "second_messages": None}

    async def fake_with_tools(messages, model_route, tools):
        calls["n"] += 1
        if calls["n"] == 1:
            return ModelResult(
                content="",
                tool_calls=[
                    ToolCall(
                        id="tu_1",
                        name="lab_pressure_simulator",
                        arguments={"compound": "meth", "temperature_c": 200, "pressure_psi": 100},
                    )
                ],
                stop_reason="tool_use",
            )
        # Capture the messages of the SECOND call so we can prove the loop
        # reconstructed the assistant turn that requested the tool (required
        # by both Anthropic and OpenAI before a tool_result turn).
        calls["second_messages"] = messages
        return ModelResult(
            content=(
                '{"reply_text":"Science, bitch.","emotion_state":"calm",'
                '"gif_search_query":"walter white","thinking":null,'
                '"tool_executed":null,"tool_log":null}'
            ),
            tool_calls=[],
            stop_reason="end_turn",
        )

    monkeypatch.setattr(c.provider, "call_model_with_tools", fake_with_tools)

    result = await c.respond_structured(
        context=[], user_message="cook", model_route="minimax/MiniMax-M3"
    )

    # Loop must have run a second round after executing the tool.
    assert calls["n"] == 2
    # Before the tool_result turn, the assistant message carrying the
    # tool_use must be present (model_route prefix "minimax" → Anthropic form).
    assert calls["second_messages"] is not None
    assistant_turns = [
        m for m in calls["second_messages"]
        if m.get("role") == "assistant" and isinstance(m.get("content"), list)
        and any(b.get("type") == "tool_use" for b in m["content"])
    ]
    assert assistant_turns, "assistant tool_use turn missing before tool_result"
    tool_use_blocks = [
        b for m in assistant_turns for b in m["content"] if b.get("type") == "tool_use"
    ]
    assert any(b.get("name") == "lab_pressure_simulator" for b in tool_use_blocks)
    # And the tool_result turn must follow it (Anthropic: user role + tool_result block).
    tool_result_turns = [
        m for m in calls["second_messages"]
        if m.get("role") == "user" and isinstance(m.get("content"), list)
        and any(b.get("type") == "tool_result" for b in m["content"])
    ]
    assert tool_result_turns, "tool_result turn missing after assistant tool_use"
    # Envelope tool fields must reflect the REAL execution, not null.
    assert result["tool_executed"] == "lab_pressure_simulator"
    assert any(s in result["tool_log"] for s in ("STABLE", "CRITICAL", "UNSTABLE"))
    assert result["reply_text"] == "Science, bitch."
