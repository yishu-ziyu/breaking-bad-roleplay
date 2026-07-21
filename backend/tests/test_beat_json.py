"""Resilient beat JSON extraction — industrial failure shapes."""

from __future__ import annotations

from agents.beat_json import parse_beat_events, parse_preview


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
