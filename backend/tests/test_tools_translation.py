"""Pure unit tests for provider-agnostic tool translation/parsing.

No config import, no HTTP — exercises the translation helpers in
``agents.tools`` that the Facade relies on. Acts as the spec/regression
for the tool primitives.
"""
from agents.tools import (
    Tool,
    ToolCall,
    ToolResult,
    translate_tools_to_anthropic,
    translate_tools_to_openai,
    parse_tool_calls_anthropic,
    parse_tool_calls_openai,
    assistant_message_with_tools,
    tool_result_messages,
)
from agents.provider import ModelResult


def _result_with_tools() -> ModelResult:
    return ModelResult(
        content="checking",
        tool_calls=[
            ToolCall(
                id="tu_1",
                name="lab_pressure_simulator",
                arguments={"compound": "meth"},
            )
        ],
        stop_reason="tool_use",
    )


def _sample_tool() -> Tool:
    return Tool(
        name="lab_pressure_simulator",
        description="Simulate reactor pressure state.",
        parameters_json_schema={
            "type": "object",
            "properties": {"compound": {"type": "string"}},
            "required": ["compound"],
        },
    )


def test_translate_to_anthropic_shape():
    out = translate_tools_to_anthropic([_sample_tool()])
    assert out == [
        {
            "name": "lab_pressure_simulator",
            "description": "Simulate reactor pressure state.",
            "input_schema": _sample_tool().parameters_json_schema,
        }
    ]


def test_translate_to_openai_shape():
    out = translate_tools_to_openai([_sample_tool()])
    assert out == [
        {
            "type": "function",
            "function": {
                "name": "lab_pressure_simulator",
                "description": "Simulate reactor pressure state.",
                "parameters": _sample_tool().parameters_json_schema,
            },
        }
    ]


def test_anthropic_tool_use_parsed():
    blocks = [
        {"type": "text", "text": "Let me check."},
        {
            "type": "tool_use",
            "id": "tu_1",
            "name": "lab_pressure_simulator",
            "input": {"compound": "meth"},
        },
    ]
    calls = parse_tool_calls_anthropic(blocks)
    assert len(calls) == 1
    assert calls[0].id == "tu_1"
    assert calls[0].name == "lab_pressure_simulator"
    assert calls[0].arguments == {"compound": "meth"}


def test_openai_tool_calls_parsed_json_string():
    msg = {
        "content": "",
        "tool_calls": [
            {
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "lab_pressure_simulator",
                    "arguments": '{"compound": "meth"}',
                },
            }
        ],
    }
    calls = parse_tool_calls_openai(msg)
    assert len(calls) == 1
    assert calls[0].name == "lab_pressure_simulator"
    assert calls[0].arguments == {"compound": "meth"}


def test_openai_tool_calls_malformed_json_empty_args():
    msg = {"tool_calls": [{"id": "c", "function": {"name": "x", "arguments": "not-json"}}]}
    calls = parse_tool_calls_openai(msg)
    assert calls[0].name == "x"
    assert calls[0].arguments == {}


def test_openai_no_tool_calls_returns_empty():
    assert parse_tool_calls_openai({"content": "hi"}) == []


def test_assistant_message_with_tools_anthropic_shape():
    msg = assistant_message_with_tools("minimax", _result_with_tools())
    assert msg["role"] == "assistant"
    assert isinstance(msg["content"], list)
    block = next(b for b in msg["content"] if b.get("type") == "tool_use")
    assert block["name"] == "lab_pressure_simulator"
    assert block["input"] == {"compound": "meth"}
    assert block["id"] == "tu_1"


def test_assistant_message_with_tools_openai_shape():
    msg = assistant_message_with_tools("stepfun", _result_with_tools())
    assert msg["role"] == "assistant"
    assert msg["content"] == "checking"
    assert len(msg["tool_calls"]) == 1
    tc = msg["tool_calls"][0]
    assert tc["function"]["name"] == "lab_pressure_simulator"
    # OpenAI sends arguments as a JSON string.
    assert tc["function"]["arguments"] == '{"compound": "meth"}'


def _two_calls() -> list[ToolCall]:
    return [
        ToolCall(id="tu_1", name="lab_pressure_simulator", arguments={"compound": "meth"}),
        ToolCall(id="tu_2", name="legal_risk_assessor", arguments={"action_description": "x"}),
    ]


def _two_results() -> list[ToolResult]:
    return [
        ToolResult(content="STABLE", is_error=False),
        ToolResult(content="HIGH risk", is_error=False),
    ]


def test_tool_result_messages_anthropic_combines_into_single_user_turn():
    """Anthropic requires ALL tool_result blocks for one assistant turn to live
    in exactly ONE user message. N separate user messages -> API error. Regression
    guard for the multi-tool-call loop on Anthropic/MiniMax/CLIProxy."""
    msgs = tool_result_messages("minimax", _two_calls(), _two_results())
    assert len(msgs) == 1, "must emit exactly one user turn, not one per tool call"
    turn = msgs[0]
    assert turn["role"] == "user"
    assert isinstance(turn["content"], list)
    blocks = turn["content"]
    assert len(blocks) == 2
    assert {b["type"] for b in blocks} == {"tool_result"}
    assert blocks[0]["tool_use_id"] == "tu_1"
    assert blocks[0]["content"] == "STABLE"
    assert blocks[1]["tool_use_id"] == "tu_2"
    assert blocks[1]["content"] == "HIGH risk"


def test_tool_result_messages_anthropic_transmits_is_error():
    """A failing tool must be distinguishable from a success on the wire, so the
    model can recover instead of proceeding on bad data."""
    calls = [ToolCall(id="tu_x", name="boom", arguments={})]
    results = [ToolResult(content="tool error: boom", is_error=True)]
    msgs = tool_result_messages("cliproxy", calls, results)
    block = msgs[0]["content"][0]
    assert block["type"] == "tool_result"
    assert block["is_error"] is True


def test_tool_result_messages_openai_emits_one_tool_message_per_call():
    """OpenAI wants one role=tool message per tool_call_id (correct as-is), but
    is_error is not a native field there, so it must not crash and must preserve id."""
    msgs = tool_result_messages("stepfun", _two_calls(), _two_results())
    assert len(msgs) == 2
    assert all(m["role"] == "tool" for m in msgs)
    assert msgs[0]["tool_call_id"] == "tu_1"
    assert msgs[0]["content"] == "STABLE"
    assert msgs[1]["tool_call_id"] == "tu_2"
    assert msgs[1]["content"] == "HIGH risk"
