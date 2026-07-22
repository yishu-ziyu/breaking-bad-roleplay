"""Character Policy owns action; upsert into agent_act."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.characters.base import _extract_structured, _normalize_action_field
from agents.director import DirectorAgent
from agents.narrative_contracts import (
    ActionProposal,
    TurnProposal,
    turn_proposal_from_character_result,
    upsert_agent_act_from_turn,
)
from agents.provider import ModelResult
from models.schemas import AgentEvent


def test_extract_nested_action():
    raw = json.dumps(
        {
            "reply_text": "We had an arrangement.",
            "emotion_state": "manipulative",
            "gif_search_query": "walter tense",
            "thinking": "He kept a copy.",
            "private_goal": "Recover control",
            "fear": "Evidence",
            "relationship_tactic": "implied threat",
            "speech_act": "implied_threat",
            "surface_intent": "clarify",
            "subtext": "I still control you",
            "action": {
                "verb": "walk_to",
                "target_id": "saul",
                "destination_anchor": "desk_front",
            },
        }
    )
    parsed = _extract_structured(raw)
    assert parsed["action"]["verb"] == "walk_to"
    assert parsed["action"]["destination_anchor"] == "desk_front"
    assert parsed["speech_act"] == "implied_threat"


def test_turn_prefers_character_action_over_director():
    turn = turn_proposal_from_character_result(
        backend_character_id="Walter White",
        reply_text="Line.",
        thinking="Mind.",
        director_action="smashes table loudly",
        character_action={"verb": "walk_to", "target_id": "saul", "destination_anchor": "desk_front"},
        private_goal="control",
        speech_act="implied_threat",
    )
    assert turn.action is not None
    assert turn.action.verb == "walk_to"
    assert turn.action.destination_anchor == "desk_front"
    assert turn.private_goal == "control"


def test_upsert_inserts_act_before_speak():
    events = [
        {
            "type": "agent_speak",
            "data": {"character_id": "Walter White", "content": "Hi"},
        }
    ]
    turn = TurnProposal(
        actor_id="walter",
        line="Hi",
        action=ActionProposal(verb="walk_to", target_id="saul", destination_anchor="desk_front"),
    )
    out, speak_i = upsert_agent_act_from_turn(
        events,
        backend_character_id="Walter White",
        turn=turn,
        speak_index=0,
    )
    assert out[0]["type"] == "agent_act"
    assert out[0]["data"]["source"] == "character_policy"
    assert "walk_to" in out[0]["data"]["action"]
    assert out[1]["type"] == "agent_speak"
    assert speak_i == 1


def test_normalize_action_string():
    assert _normalize_action_field("sit") == {"verb": "sit"}


def _mr(text: str) -> ModelResult:
    return ModelResult(content=text, tool_calls=[], stop_reason="end_turn")


@pytest.fixture
def director():
    return DirectorAgent(provider=MagicMock())


@pytest.mark.asyncio
async def test_generate_beat_uses_character_action(director):
    plan = json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Walter White",
                    "content": "draft",
                    "emotion_state": "calm",
                    "gif_search_query": "x",
                },
            }
        ]
    )
    sub = json.dumps(
        {
            "reply_text": "I think you misunderstood our arrangement.",
            "emotion_state": "manipulative",
            "gif_search_query": "walter white manipulative",
            "thinking": "He kept a copy.",
            "private_goal": "Recover control",
            "fear": "Evidence",
            "relationship_tactic": "implied threat",
            "speech_act": "implied_threat",
            "surface_intent": "clarify",
            "subtext": "I still control you",
            "action": {
                "verb": "walk_to",
                "target_id": "saul",
                "destination_anchor": "desk_front",
            },
            "tool_executed": None,
            "tool_log": None,
        }
    )
    director.provider.call_model = AsyncMock(return_value=plan)
    director.provider.call_model_with_tools = AsyncMock(return_value=_mr(sub))
    director.provider.resolve_model_route = MagicMock(
        return_value="stepfun/step-3.7-flash"
    )
    mock_db = MagicMock()
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()
    mock_db.execute = AsyncMock()

    collected: list[AgentEvent] = []
    with patch("agents.director.update_dossiers", new=AsyncMock(return_value=None)):
        async for ev in director._generate_beat(
            task="t",
            outline="1. Office",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "office"},
            db=mock_db,
            session_id="sess-act",
            language="en",
        ):
            collected.append(ev)

    acts = [e for e in collected if e.type == "agent_act"]
    speaks = [e for e in collected if e.type == "agent_speak"]
    thinks = [e for e in collected if e.type == "agent_think"]
    assert acts, "character action must yield agent_act"
    assert acts[0].data.get("source") == "character_policy"
    assert acts[0].data.get("verb") == "walk_to"
    assert "desk_front" in (acts[0].data.get("action") or "")
    assert speaks[0].data["content"].startswith("I think you misunderstood")
    assert thinks[0].data["thought_content"] == "He kept a copy."
    act_i = next(i for i, e in enumerate(collected) if e.type == "agent_act")
    speak_i = next(i for i, e in enumerate(collected) if e.type == "agent_speak")
    assert act_i < speak_i
