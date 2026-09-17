from copy import deepcopy
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.director import DirectorAgent
from agents.narrative_contracts import ActionProposal, BeatContract, TurnProposal
from scenes.validator import validate_world_turn
from scenes.state_reducer import board_from_world
from scenes.world_state import WorldState


@pytest.mark.asyncio
async def test_only_final_rewritten_line_reaches_next_speaker_and_board():
    director = DirectorAgent(MagicMock())
    director.provider.resolve_model_route.return_value = "stepfun/test"
    plan = [{"type": "agent_speak", "data": {"character_id": name, "content": "草稿"}}
            for name in ["Walter White", "Jesse Pinkman"]]
    director._plan_beat_events = AsyncMock(return_value=(plan, None, []))
    director._rewrite_english_fields_to_zh = AsyncMock(side_effect=lambda events, **kwargs: events)
    observed = []

    async def respond(**kwargs):
        observed.append(kwargs)
        return {"reply_text": "候选原句" if len(observed) == 1 else "我听到了。",
                "emotion_state": "tense", "gif_search_query": None, "thinking": None,
                "action": {"verb": "idle_tense"}}

    async def polish(events, **kwargs):
        out = deepcopy(events)
        for event in out:
            if event["type"] == "agent_speak":
                event["data"]["content"] = event["data"]["content"].replace("候选原句", "最终台词")
        return out

    board = {"present_cast": ["walter", "jesse"], "shared_facts": [], "irreversible_costs": [], "updated_at_beat": 0}
    save = AsyncMock()
    with patch("agents.characters.base.BaseCharacter.respond_structured", side_effect=respond), \
         patch("agents.director.rewrite_dubbing_in_events", side_effect=polish), \
         patch("agents.continuity_board.load_or_init_session_board", AsyncMock(return_value=board)), \
         patch("agents.continuity_board.save_session_board", save):
        events = [event async for event in director._generate_beat(
            task="t", outline="1. 房车", beat_index=0, context={}, language="zh",
        )]
    assert len(observed) == 2
    assert "最终台词" in str(observed[1]["context"])
    assert "候选原句" not in str(observed[1]["context"])
    assert "候选原句" not in str(save.await_args)
    assert any(event.data.get("content") == "最终台词" for event in events)


def test_performance_cannot_transfer_items_outside_world_rules():
    contract = BeatContract(beat_id="beat_1", dramatic_role="progressive", location_id="desert",
                            present_characters=["walter", "jesse"], value_before="uncertain",
                            value_after="tense", dramatic_question="What now?", pressure_source="time")
    turn = TurnProposal(actor_id="jesse", line="Take it.", action=ActionProposal(verb="hand_over", target_id="walter"))
    result = validate_world_turn(contract, turn, board={"authoritative": True, "present_cast": ["walter", "jesse"]})
    assert not result.ok
    assert any(issue.code == "unsettled_action" for issue in result.issues)


@pytest.mark.asyncio
async def test_authoritative_character_does_not_receive_director_private_context():
    director = DirectorAgent(MagicMock())
    director.provider.resolve_model_route.return_value = "stepfun/test"
    secret = "PRIVATE_MARKER_947_ONLY_WALTER_KNOWS"
    director._plan_beat_events = AsyncMock(return_value=([
        {"type": "agent_speak", "data": {"character_id": "Jesse Pinkman", "content": secret}},
    ], None, []))
    director._rewrite_english_fields_to_zh = AsyncMock(side_effect=lambda events, **kwargs: events)
    responder = AsyncMock(return_value={"reply_text": "What now?", "emotion_state": "tense",
        "gif_search_query": None, "thinking": None, "action": {"verb": "idle_tense"}})
    board = {"authoritative": True, "player_actor_id": "walter", "location": "desert",
             "present_cast": ["walter", "jesse"], "shared_facts": [
                 {"id": "secret", "text": secret, "known_by": ["walter"], "hidden_from": ["jesse"]},
             ]}
    with patch("agents.characters.base.BaseCharacter.respond_structured", responder):
        events = [event async for event in director._generate_beat(
            task=secret, outline=f"1. {secret}", scene_desc=secret, beat_index=0,
            context={"board_override": board, "player_actor_id": "walter", "public_scene": "The RV in the desert."},
            language="en",
        )]
    assert any(event.type == "agent_speak" for event in events)
    assert secret not in str(responder.await_args)


def test_open_conversation_projection_does_not_inject_a_random_canon_era():
    board = board_from_world(
        WorldState(
            scenario_id="conversation",
            player_id="walter",
            location="custom_scene",
            locations=["custom_scene"],
            present=["walter", "saul"],
        )
    )

    assert board["authoritative"] is True
    assert board["era"] == "custom"
    assert board["shared_facts"] == []
    assert board["open_tensions"] == []
    assert board["irreversible_costs"] == []
