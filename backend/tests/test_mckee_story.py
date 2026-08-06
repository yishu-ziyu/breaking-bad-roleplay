"""McKee Story engine unit tests (v1 structure + v2 craft disciplines)."""

from __future__ import annotations

from agents import mckee_story
from agents.director import DIRECTOR_SYSTEM_PROMPT, DirectorAgent


FULL_OUTLINE = """
PROTAGONIST: Hank Schrader
SPINE: Hank must uncover the truth without destroying his family
CONSCIOUS_DESIRE: catch whoever is behind the blue meth
UNCONSCIOUS_DESIRE: keep the good cop / good brother-in-law identity
VALUE_PAIR: loyalty / betrayal
OPPOSITION: Walter White, family expectation, DEA pressure
MAJOR_QUESTION: Can Hank hold the truth between love and duty?
CONTROLLING_IDEA: Truth rips the family open because loyalty covered a greater lie
1. [setup] Schrader backyard — value: safety→unease — gap: banter meets evasion — risk: low
2. [inciting] DEA office — value: imbalance→order — gap: lead hits family — risk: mid
3. [progressive] White living room — value: trust→suspicion — gap: soft probe fails — risk: high
4. [crisis] Evidence room — value: duty vs family — gap: either choice irreversible — risk: extreme
5. [climax] Desert road — value: facade→break — gap: inevitable yet surprising — risk: ultimate
6. [resolution] Kitchen — value: aftershock→cold settle — gap: new balance locked — risk: residue
"""


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
    scenes = DirectorAgent._parse_outline(FULL_OUTLINE)
    assert len(scenes) == 6
    assert all("PROTAGONIST" not in s for s in scenes)
    assert all("CONTROLLING_IDEA" not in s for s in scenes)
    assert scenes[0].startswith("[setup]")
    assert scenes[1].startswith("[inciting]")
    assert scenes[4].startswith("[climax]")
    assert "gap:" in scenes[0]
    assert "risk:" in scenes[2]


def test_parse_spine_meta_v2_fields():
    spine = mckee_story.parse_spine_meta(FULL_OUTLINE)
    assert spine["protagonist"] == "Hank Schrader"
    assert "truth" in spine["spine"].lower() or "uncover" in spine["spine"].lower()
    assert spine["conscious_desire"]
    assert spine["unconscious_desire"]
    assert spine["opposition"]
    assert spine["controlling_idea"]
    assert "because" in spine["controlling_idea"].lower()
    assert spine["major_question"]


def test_value_polarity_and_alternation_heuristic():
    assert mckee_story.extract_value_end_polarity(
        "value: safety→unease"
    ) == -1
    assert mckee_story.extract_value_end_polarity(
        "value: chaos→order"
    ) == 1
    assert mckee_story.extract_value_end_polarity(
        "value: trust→duty vs family"
    ) == -1


def test_validate_outline_structure_ok_and_warn():
    scenes = DirectorAgent._parse_outline(FULL_OUTLINE)
    assert mckee_story.validate_outline_structure(scenes) == []
    weak = ["kitchen chat", "office chat"]
    warns = mckee_story.validate_outline_structure(weak)
    assert any("beats" in w or "tags" in w or "value" in w for w in warns)
    # Tagged value/gap but no risk → soft risk warning
    no_risk = [
        "[setup] kitchen — value: a→b — gap: x",
        "[inciting] office — value: c→d — gap: y",
        "[progressive] yard — value: e→f — gap: z",
        "[crisis] lab — value: g→h — gap: w",
        "[climax] road — value: i→j — gap: v",
    ]
    risk_warns = mckee_story.validate_outline_structure(no_risk)
    assert any("risk" in w for w in risk_warns)


def test_legacy_outline_still_parses():
    legacy = "1. RV in the desert — cook\n2. Kitchen — confront\n3. DEA — lead"
    scenes = DirectorAgent._parse_outline(legacy)
    assert len(scenes) == 3
    assert "RV" in scenes[0]


def test_outline_prompt_requires_v2_disciplines():
    en = mckee_story.build_outline_user_prompt(
        "Hank digs into Heisenberg", "en", active_character="Hank Schrader"
    )
    assert "CONTROLLING_IDEA" in en
    assert "CONSCIOUS_DESIRE" in en
    assert "OPPOSITION" in en
    assert "diminishing" in en.lower() or "polarity" in en.lower() or "alternate" in en.lower()
    assert "[setup" in en
    assert "gap" in en.lower()
    zh = mckee_story.build_outline_user_prompt("汉克查案", "zh")
    assert "主控" in zh or "CONTROLLING" in zh
    assert "鸿沟" in zh or "gap" in zh


def test_beat_addon_v2_includes_hinge_polarity_inside_out():
    addon = mckee_story.build_beat_planning_addon(
        "[progressive] lab — value: trust→suspicion — gap: x — risk: high",
        beat_index=2,
        total_beats=6,
        language="en",
        previous_scene_desc="[inciting] office — value: order→imbalance — gap: lead",
        outline_text=FULL_OUTLINE,
    )
    assert "progressive" in addon.lower()
    assert "gap" in addon.lower()
    assert "hinge" in addon.lower() or "third element" in addon.lower()
    assert "inside-out" in addon.lower() or "If I were" in addon
    assert "CONTROLLING_IDEA" in addon or "controlling" in addon.lower()
    assert "dilemma" in addon.lower() or "crisis" in addon.lower() or "climax" in addon.lower()


def test_outline_event_payload_shapes():
    scenes = DirectorAgent._parse_outline(FULL_OUTLINE)
    payload = mckee_story.outline_event_payload(FULL_OUTLINE, scenes=scenes)
    assert "content" in payload
    assert payload["mckee_spine"]["protagonist"] == "Hank Schrader"
    assert payload["mckee_beat_count"] == 6
    assert "mckee_warnings" not in payload  # clean outline


def test_system_addon_present_on_director_prompt():
    assert "MCKEE STORY ENGINE" in DIRECTOR_SYSTEM_PROMPT
    assert "CONTROLLING_IDEA" in DIRECTOR_SYSTEM_PROMPT
    assert "inside-out" in DIRECTOR_SYSTEM_PROMPT.lower() or "If I were" in DIRECTOR_SYSTEM_PROMPT


def test_director_outline_event_helper():
    evt = DirectorAgent._outline_event(FULL_OUTLINE)
    assert evt.type == "outline"
    assert evt.data["mckee_spine"]["controlling_idea"]
    assert evt.data["mckee_beat_count"] == 6


def test_value_turn_continuation_not_meta():
    """Beat-local value: A→B lines stay playable; bare prose is not meta."""
    assert mckee_story.is_meta_outline_line("value: safety→unease") is False
    assert mckee_story.is_meta_outline_line("VALUE: trust→suspicion") is False
    assert mckee_story.is_meta_outline_line("value: order->imbalance") is False
    assert mckee_story.is_meta_outline_line("VALUE_PAIR: loyalty / betrayal") is True
    assert mckee_story.is_meta_outline_line("CONSCIOUS_DESIRE: catch the cook") is True
    # Bare VALUE/CONSCIOUS without KEY: value form must not overmatch.
    assert mckee_story.is_meta_outline_line("VALUE shifts as pressure mounts") is False
    assert mckee_story.is_meta_outline_line("CONSCIOUS choice under fire") is False
    assert mckee_story.is_meta_outline_line("OPPOSITION hardens") is False

    multi = """
1. [setup] backyard BBQ
value: safety→unease
gap: banter meets evasion
2. [inciting] DEA office
value: order→imbalance
"""
    filtered = mckee_story.filter_playable_outline_lines(multi)
    assert "value: safety→unease" in filtered
    assert "value: order→imbalance" in filtered
    scenes = DirectorAgent._parse_outline(multi)
    assert len(scenes) == 2
    assert "value: safety→unease" in scenes[0]
    assert "value: order→imbalance" in scenes[1]


def test_meta_only_outline_returns_empty_not_fallback():
    """Spine-only responses must not resurrect as a single fake beat."""
    meta_only = """
PROTAGONIST: Hank Schrader
SPINE: uncover the truth without destroying his family
CONSCIOUS_DESIRE: catch whoever is behind the blue meth
UNCONSCIOUS_DESIRE: keep the good cop identity
VALUE_PAIR: loyalty / betrayal
OPPOSITION: Walter White
MAJOR_QUESTION: Can Hank hold the truth?
CONTROLLING_IDEA: Truth rips the family open because loyalty covered a greater lie
# BEATS
"""
    assert mckee_story.filter_playable_outline_lines(meta_only) == ""
    scenes = DirectorAgent._parse_outline(meta_only)
    assert scenes == []


async def test_process_meta_only_outline_yields_no_beats_error():
    """Main Story process() must error on empty playable scenes, not complete."""
    from unittest.mock import AsyncMock

    from agents.director import DirectorAgent

    meta_only = (
        "PROTAGONIST: Hank Schrader\n"
        "SPINE: uncover the truth without destroying his family\n"
        "VALUE_PAIR: loyalty / betrayal\n"
        "CONTROLLING_IDEA: Truth rips the family open because loyalty covered a greater lie\n"
    )
    provider = AsyncMock()
    director = DirectorAgent(provider=provider)
    director._generate_outline = AsyncMock(return_value=meta_only)

    events = []
    async for ev in director.process(task="Hank digs into Heisenberg"):
        events.append(ev)

    types = [e.type for e in events]
    assert "error" in types
    assert "complete" not in types
    err = next(e for e in events if e.type == "error")
    msg = str(err.data.get("message", "")).lower()
    assert "playable" in msg or "可玩" in msg or "no" in msg
