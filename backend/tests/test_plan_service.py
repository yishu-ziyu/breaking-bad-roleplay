"""PlanService + BeatRuntime orchestration seams (DEC-0004)."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator
from unittest.mock import MagicMock

import pytest

from agents.beat_runtime import BeatRuntime
from agents.director import DirectorAgent
from agents.plan_service import BeatPlan, PlanService, StoryPlan
from models.schemas import AgentEvent


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
2. [inciting] DEA office — value: order→imbalance — gap: lead hits family — risk: mid
3. [progressive] White living room — value: trust→suspicion — gap: soft probe fails — risk: high
4. [crisis] Evidence room — value: duty vs family — gap: either choice irreversible — risk: extreme
5. [climax] Desert road — value: facade→break — gap: inevitable yet surprising — risk: ultimate
6. [resolution] Kitchen — value: aftershock→cold settle — gap: new balance locked — risk: residue
"""


def test_parse_produces_structured_spine_and_beats():
    plan = PlanService.parse(FULL_OUTLINE)
    assert plan.spine["protagonist"] == "Hank Schrader"
    assert plan.spine["controlling_idea"]
    assert len(plan.beats) == 6
    assert plan.beats[0].role == "setup"
    assert plan.beats[1].role == "inciting"
    assert plan.beats[4].role == "climax"
    assert plan.beats[0].value_before == "safety"
    assert plan.beats[0].value_after == "unease"
    assert plan.beats[0].gap and "banter" in plan.beats[0].gap
    assert plan.beats[0].risk == "low"
    assert plan.beats[2].risk == "high"
    assert plan.warnings == []


def test_story_plan_json_roundtrip():
    plan = PlanService.parse(FULL_OUTLINE)
    payload = plan.to_json()
    restored = StoryPlan.from_json(payload)
    assert restored.spine == plan.spine
    assert len(restored.beats) == len(plan.beats)
    assert restored.beats[3].role == "crisis"
    assert restored.beats[3].gap
    # from_dict via PlanService
    again = PlanService.from_dict(json.loads(payload))
    assert again.beats[5].role == "resolution"


def test_outline_event_includes_story_plan():
    plan = PlanService.parse(FULL_OUTLINE)
    data = PlanService.outline_event_data(plan)
    assert "content" in data
    assert data["mckee_spine"]["protagonist"] == "Hank Schrader"
    assert "story_plan" in data
    sp = data["story_plan"]
    assert sp["beat_count"] == 6
    assert sp["beats"][1]["role"] == "inciting"
    assert sp["beats"][1]["value_before"] == "order"
    assert sp["beats"][1]["value_after"] == "imbalance"
    assert sp["spine"]["controlling_idea"]


def test_quality_checks_on_structured_plan_not_string_contains():
    """DEC-0004 acceptance: story quality test against structured plan fields."""
    plan = PlanService.parse(FULL_OUTLINE)
    checks = PlanService.quality_checks(plan)
    assert checks["has_beats"] is True
    assert checks["enough_beats"] is True
    assert checks["has_inciting"] is True
    assert checks["has_climax"] is True
    assert checks["most_have_value_turn"] is True
    assert checks["most_have_gap"] is True
    assert checks["most_have_risk"] is True
    assert checks["has_spine_controlling_idea"] is True
    assert checks["has_spine_protagonist"] is True
    assert checks["no_warnings"] is True

    weak = PlanService.parse("1. kitchen chat\n2. office chat")
    weak_checks = PlanService.quality_checks(weak)
    assert weak_checks["has_beats"] is True
    assert weak_checks["enough_beats"] is False
    assert weak_checks["most_have_value_turn"] is False
    assert weak_checks["no_warnings"] is False


def test_director_parse_outline_delegates_to_plan_service():
    scenes = DirectorAgent._parse_outline(FULL_OUTLINE)
    plan = PlanService.parse(FULL_OUTLINE)
    assert scenes == plan.scene_lines()
    assert len(scenes) == 6


def test_director_outline_event_carries_story_plan():
    evt = DirectorAgent._outline_event(FULL_OUTLINE)
    assert evt.type == "outline"
    assert "story_plan" in evt.data
    assert evt.data["story_plan"]["beats"][0]["role"] == "setup"
    assert evt.data["mckee_beat_count"] == 6


def test_parse_from_scenes_keeps_spine():
    scenes = PlanService.parse(FULL_OUTLINE).scene_lines()
    plan = PlanService.parse_from_scenes(
        scenes[:3],
        raw_outline="chapter",
        spine={"protagonist": "Hank Schrader"},
    )
    assert len(plan.beats) == 3
    assert plan.spine["protagonist"] == "Hank Schrader"
    assert plan.beats[0].role == "setup"


@pytest.mark.asyncio
async def test_beat_runtime_runs_single_plan_slice():
    """BeatRuntime pulls beat text from StoryPlan and calls director once."""
    plan = PlanService.parse(FULL_OUTLINE)
    calls: list[dict[str, Any]] = []

    class FakeDirector:
        def _short_scene_name(self, scene_desc: str) -> str:
            return scene_desc.split("—")[0].strip()[:40]

        async def _generate_beat(self, **kwargs) -> AsyncIterator[AgentEvent]:
            calls.append(kwargs)
            yield AgentEvent(type="status", data={"message": "ok"})
            yield AgentEvent(
                type="beat_ready",
                data={"beat_id": f"beat_{kwargs['beat_index'] + 1}"},
            )

    runtime = BeatRuntime(FakeDirector())
    events = []
    async for ev in runtime.run_beat(
        plan=plan, beat_index=1, task="find Heisenberg", language="en"
    ):
        events.append(ev)

    assert len(calls) == 1
    assert calls[0]["beat_index"] == 1
    assert calls[0]["scene_desc"] == plan.beats[1].text
    assert "[inciting]" in calls[0]["scene_desc"]
    assert calls[0]["outline"] == plan.raw_outline
    assert events[-1].type == "beat_ready"
    ctx = runtime.context_for(plan, 1)
    assert "previous_scene" in ctx
    assert ctx["previous_scene_desc"] == plan.beats[0].text


@pytest.mark.asyncio
async def test_beat_runtime_index_error():
    plan = PlanService.parse(FULL_OUTLINE)
    runtime = BeatRuntime(MagicMock())
    with pytest.raises(IndexError):
        async for _ in runtime.run_beat(plan=plan, beat_index=99, task="x"):
            pass


def test_beat_plan_dataclass_fields():
    b = BeatPlan(
        index=0,
        text="[setup] yard — value: a→b — gap: g — risk: low",
        role="setup",
        value_before="a",
        value_after="b",
        gap="g",
        risk="low",
    )
    d = b.to_dict()
    assert BeatPlan.from_dict(d).risk == "low"
