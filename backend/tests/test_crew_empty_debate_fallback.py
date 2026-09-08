"""Player-lab regression (2026-09-09): billed crew turn must never be empty.

A crew chat costs 2 credits and is billed BEFORE generation. When the
model's raw reply failed to parse as a debate JSON array,
_parse_crew_debate_logs returned [] and the API answered 200 with
debate_logs=[] — the player saw nothing at all. The director now degrades
to a single visible fallback line; these tests pin the parser behavior
the fallback relies on.
"""

import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from agents.director import DirectorAgent


def test_parser_returns_empty_for_prose():
    raw = "Walter: Fine. Jesse: no way, man. (the model wrote prose, not JSON)"
    logs = DirectorAgent._parse_crew_debate_logs(raw, ["Walter White", "Jesse Pinkman"])
    assert logs == []


def test_parser_keeps_known_participants_only():
    raw = '[{"character_id": "Walter White", "content": "We do this quietly."}, {"character_id": "Todd Alquist", "content": "yeah totally"}]'
    logs = DirectorAgent._parse_crew_debate_logs(raw, ["Walter White"])
    assert len(logs) == 1
    assert logs[0]["sender"] == "Walter White"


def test_parser_reads_fenced_json():
    raw = '```json\n[{"character_id": "Jesse Pinkman", "content": "Yo, no.", "emotion_state": "scared"}]\n```'
    logs = DirectorAgent._parse_crew_debate_logs(raw, ["Jesse Pinkman"])
    assert len(logs) == 1
    assert logs[0]["text"] == "Yo, no."
    assert logs[0]["emotion"] == "scared"
