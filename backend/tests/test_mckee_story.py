"""McKee Story engine unit tests (outline parse + role inference + prompts)."""

from __future__ import annotations

from agents import mckee_story
from agents.director import DirectorAgent


def test_extract_and_infer_roles():
    assert mckee_story.extract_beat_role(
        "[inciting] DEA office — value: order→imbalance"
    ) == "inciting"
    assert mckee_story.extract_beat_role("plain kitchen scene") is None
    assert mckee_story.infer_beat_role(0, 5) == "setup"
    assert mckee_story.infer_beat_role(1, 5) == "inciting"
    assert mckee_story.infer_beat_role(3, 5) == "crisis"
    assert mckee_story.infer_beat_role(4, 5) == "climax"
    assert mckee_story.resolve_beat_role("[climax] desert", 0, 5) == "climax"
    assert mckee_story.resolve_beat_role("no tag", 0, 5) == "setup"


def test_filter_meta_lines_keeps_numbered_beats():
    raw = """
PROTAGONIST: Hank Schrader
SPINE: restore balance after a lead points home
VALUE_PAIR: loyalty / betrayal
MAJOR_QUESTION: Can Hank hold the truth?
1. [setup] Backyard — value: safety→unease — gap: banter meets evasion
2. [inciting] DEA office — value: order→chaos — gap: lead hits family
3. [progressive] Living room — value: trust→doubt — gap: soft probe fails
4. [crisis] Evidence room — value: duty vs family — gap: no clean exit
5. [climax] Desert road — value: facade→break — gap: must confront
6. [resolution] Kitchen — value: aftershock — gap: new balance locked
"""
    scenes = DirectorAgent._parse_outline(raw)
    assert len(scenes) == 6
    assert all("PROTAGONIST" not in s for s in scenes)
    assert scenes[0].startswith("[setup]")
    assert scenes[1].startswith("[inciting]")
    assert scenes[4].startswith("[climax]")
    assert "gap:" in scenes[0]


def test_legacy_outline_still_parses():
    legacy = "1. RV in the desert — cook\n2. Kitchen — confront\n3. DEA — lead"
    scenes = DirectorAgent._parse_outline(legacy)
    assert len(scenes) == 3
    assert "RV" in scenes[0]


def test_outline_prompt_requires_mckee_fields():
    en = mckee_story.build_outline_user_prompt(
        "Hank digs into Heisenberg", "en", active_character="Hank Schrader"
    )
    assert "McKee" in en or "mckee" in en.lower() or "value" in en.lower()
    assert "[setup" in en
    assert "gap" in en.lower()
    assert "Hank Schrader" in en
    zh = mckee_story.build_outline_user_prompt("汉克查案", "zh")
    assert "激励" in zh or "麦基" in zh or "价值" in zh
    assert "[inciting]" in zh or "inciting" in zh


def test_beat_addon_mentions_value_turn_and_gap():
    addon = mckee_story.build_beat_planning_addon(
        "[progressive] lab",
        beat_index=2,
        total_beats=6,
        language="en",
    )
    assert "progressive" in addon.lower()
    assert "value" in addon.lower()
    assert "gap" in addon.lower()


def test_system_addon_present_on_director_prompt():
    from agents.director import DIRECTOR_SYSTEM_PROMPT

    assert "MCKEE STORY ENGINE" in DIRECTOR_SYSTEM_PROMPT
    assert "inciting" in DIRECTOR_SYSTEM_PROMPT
