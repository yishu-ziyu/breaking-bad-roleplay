"""Resilient beat JSON extraction — industrial failure shapes."""

from __future__ import annotations

from agents.beat_json import parse_beat_events, parse_beat_plan, parse_preview


def test_plain_array():
    raw = '[{"type":"agent_speak","data":{"character_id":"Walter White","content":"hi"}}]'
    ev = parse_beat_events(raw)
    assert len(ev) == 1
    assert ev[0]["type"] == "agent_speak"


def test_fenced_json():
    raw = '```json\n[{"type":"agent_think","data":{"character_id":"Jesse","thought_content":"x"}}]\n```'
    assert parse_beat_events(raw)[0]["type"] == "agent_think"


def test_prose_before_and_after():
    raw = (
        "Here is the beat plan for this scene:\n"
        '[{"type":"agent_act","data":{"character_id":"Walter White","action":"sits"}}]\n'
        "End of plan."
    )
    assert parse_beat_events(raw)[0]["type"] == "agent_act"


def test_single_object_wraps():
    raw = '{"type":"agent_speak","data":{"character_id":"Hank Schrader","content":"DEA"}}'
    assert len(parse_beat_events(raw)) == 1


def test_events_wrapper_object():
    raw = '{"events":[{"type":"agent_speak","data":{"character_id":"Saul Goodman","content":"call me"}}]}'
    assert parse_beat_events(raw)[0]["data"]["character_id"] == "Saul Goodman"


def test_trailing_comma_repaired():
    raw = '[{"type":"agent_speak","data":{"character_id":"Mike Ehrmantraut","content":"no"}},]'
    assert parse_beat_events(raw)[0]["type"] == "agent_speak"


def test_balanced_brackets_ignore_inner_brackets_in_strings():
    # Dialogue contains [brackets] that must not confuse the array scanner.
    raw = (
        '[{"type":"agent_speak","data":{"character_id":"Walter White",'
        '"content":"Go to [lab] now"}}] trailing garbage [not json'
    )
    ev = parse_beat_events(raw)
    assert len(ev) == 1
    assert "[lab]" in ev[0]["data"]["content"]


def test_thinking_tags_stripped():
    raw = (
        "<think>I will output JSON</think>\n"
        '[{"type":"agent_speak","data":{"character_id":"Gus Fring","content":"hello"}}]'
    )
    assert parse_beat_events(raw)[0]["type"] == "agent_speak"


def test_empty_and_prose_only():
    assert parse_beat_events("") == []
    assert parse_beat_events(None) == []
    assert parse_beat_events("Walter walks into the room.") == []


def test_preview_truncates():
    p = parse_preview("x" * 500, limit=50)
    assert len(p) <= 50
    assert p.endswith("…")


def test_dec0005_contract_envelope():
    raw = """
    {
      "contract": {
        "beat_id": "beat_01",
        "dramatic_role": "setup",
        "location_id": "kitchen",
        "present_characters": ["walter", "skyler"],
        "value_before": "a",
        "value_after": "b",
        "dramatic_question": "q",
        "pressure_source": "p"
      },
      "events": [
        {"type":"agent_speak","data":{"character_id":"Walter White","content":"hi"}}
      ]
    }
    """
    events, contract = parse_beat_plan(raw)
    assert len(events) == 1
    assert events[0]["type"] == "agent_speak"
    assert contract is not None
    assert contract["beat_id"] == "beat_01"
    assert contract["present_characters"] == ["walter", "skyler"]


# ---------------------------------------------------------------------------
# Salvage: an agent_speak that closes its brace before "recommended_model"
# leaves a dangling key inside the events array. Observed twice on
# 2026-09-18 (MiniMax-M3) and both times it lost the whole beat.
# ---------------------------------------------------------------------------

_MALFORMED_SPEAK_PLAN = (
    '{"contract":{"beat_id":"beat_01","dramatic_role":"setup",'
    '"present_characters":["walter","jesse"]},'
    '"events":['
    '{"type":"agent_act","data":{"character_id":"Jesse Pinkman","action":"look_at"},'
    '"recommended_model":"minimax/MiniMax-M3"},'
    '{"type":"agent_speak","data":{"character_id":"Jesse Pinkman",'
    '"content":"Kill the lights."},"emotion_state":"tense",'
    '"gif_search_query":"jesse tense"},"recommended_model":"minimax/MiniMax-M3"},'
    '{"type":"world_state_delta","data":{"deltas":[{"target":"Jesse Pinkman",'
    '"field":"fear","old_value":"low","new_value":"high"}]},'
    '"recommended_model":"minimax/MiniMax-M3"}]}'
)


def test_malformed_speak_close_is_salvaged_with_dialogue():
    events, contract = parse_beat_plan(_MALFORMED_SPEAK_PLAN)

    types = [e["type"] for e in events]
    assert types == ["agent_act", "agent_speak", "world_state_delta"]
    assert events[1]["data"]["content"] == "Kill the lights."
    assert contract is not None and contract["beat_id"] == "beat_01"


def test_truncated_plan_keeps_completed_events():
    truncated = _MALFORMED_SPEAK_PLAN[: _MALFORMED_SPEAK_PLAN.index("world_state_delta")]

    events, _contract = parse_beat_plan(truncated)

    assert [e["type"] for e in events] == ["agent_act", "agent_speak"]


def test_salvage_ignores_objects_without_type():
    raw = (
        '{"events":[{"reason":"no type here"},'
        '{"type":"agent_think","data":{"character_id":"Jesse Pinkman",'
        '"thought_content":"hmm"},"recommended_model":"x"}]}'
    )
    assert [e["type"] for e in parse_beat_events(raw)] == ["agent_think"]
