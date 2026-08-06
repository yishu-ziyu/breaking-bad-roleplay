"""Continuity Board injection into Director beat generation.

Given a planned agent_speak beat, the character sub-agent must receive:
1. A CONTINUITY BOARD block filtered by known_by
2. Prior spoken lines from earlier speakers in the same beat
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.continuity_board import (
    filter_board_for_character,
    format_board_prompt,
    new_session_board,
)
from agents.director import DirectorAgent
from agents.provider import ModelResult, ProviderFacade
from models.schemas import AgentEvent


def _mr(text: str) -> ModelResult:
    return ModelResult(content=text, tool_calls=[], stop_reason="end_turn")


def _structured(reply: str, emotion: str = "tense", gif: str = "tense face") -> str:
    return json.dumps(
        {
            "reply_text": reply,
            "emotion_state": emotion,
            "gif_search_query": gif,
            "thinking": None,
            "tool_executed": None,
            "tool_log": None,
        }
    )


@pytest.fixture
def mock_provider():
    provider = MagicMock(spec=ProviderFacade)
    provider.resolve_model_route.return_value = "stepfun/step-3.7-flash"
    provider.call_model = AsyncMock()
    provider.call_model_with_tools = AsyncMock()
    return provider


@pytest.fixture
def director(mock_provider):
    return DirectorAgent(mock_provider, enable_dossier_updates=False)


@pytest.mark.asyncio
async def test_second_speaker_receives_prior_line_and_board(director, mock_provider):
    """Later speaker must hear the earlier line; Jesse gets board facts he knows."""
    board = new_session_board(session_id="sess-board-1", era="s3_mid", location="lab")
    plan = json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Walter White",
                    "content": "DRAFT_WALT",
                    "emotion_state": "calm",
                    "gif_search_query": "walt calm",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Jesse Pinkman",
                    "content": "DRAFT_JESSE",
                    "emotion_state": "tense",
                    "gif_search_query": "jesse tense",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
            {
                "type": "world_state_delta",
                "data": {
                    "deltas": [
                        {
                            "target": "lab",
                            "field": "pressure",
                            "old_value": "steady",
                            "new_value": "rising after argument",
                        }
                    ]
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
        ]
    )
    mock_provider.call_model = AsyncMock(return_value=plan)

    captured: list[dict] = []

    async def fake_structured(
        self,
        context,
        user_message,
        model_route="x",
        voice_example=None,
        dossier_context=None,
        **kwargs,
    ):
        captured.append(
            {
                "name": self.name,
                "context": list(context),
                "user_message": user_message,
                "dossier_context": dossier_context or "",
            }
        )
        who = self.name
        return {
            "reply_text": f"{who} spoken",
            "emotion_state": "tense",
            "gif_search_query": "face",
            "thinking": None,
            "action": {"verb": "look_at", "target_id": "jesse" if "Walter" in who else "walter"},
            "tool_executed": None,
            "tool_log": None,
        }

    with patch(
        "agents.continuity_board.load_or_init_session_board",
        new=AsyncMock(return_value=board),
    ), patch(
        "agents.continuity_board.save_session_board",
        new=AsyncMock(),
    ), patch(
        "agents.director.update_dossiers",
        new=AsyncMock(return_value=None),
    ), patch(
        "agents.characters.base.BaseCharacter.respond_structured",
        new=fake_structured,
    ):
        events: list[AgentEvent] = []
        async for ev in director._generate_beat(
            task="Argue about the cook schedule",
            outline="1. Superlab - argument",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "Superlab"},
            scene_desc="Superlab - argument",
            session_factory=None,
            session_id="sess-board-1",
        ):
            events.append(ev)

    assert len(captured) == 2
    walt_call, jesse_call = captured
    assert walt_call["name"] == "Walter White"
    assert jesse_call["name"] == "Jesse Pinkman"

    # Board injected for both
    assert "CONTINUITY BOARD" in walt_call["dossier_context"]
    assert "CONTINUITY BOARD" in jesse_call["dossier_context"]
    # Jesse should know Gus roof fact; must not get Skyler's household suspicion
    assert "household story is incomplete" not in jesse_call["dossier_context"]
    assert "Gus" in jesse_call["dossier_context"] or "cook" in jesse_call["dossier_context"].lower()

    # Later speaker hears earlier line
    assert jesse_call["context"], "Jesse must receive prior spoken context"
    joined = " ".join(c["content"] for c in jesse_call["context"])
    assert "Walter White" in joined
    assert "spoken" in joined or "Walter" in joined

    # Walt is first: no prior lines
    assert walt_call["context"] == []


@pytest.mark.asyncio
async def test_board_deltas_does_not_land_after_beat(director, mock_provider):
    """DEC-0005 P4: the LLM world_state_delta does NOT mutate the board.

    The validated-turn path through ``apply_validated_turn`` is the sole
    writer of board truth. The advisory helper
    ``record_llm_proposed_deltas`` only returns proposals for observability;
    it does not write to the board. The beat below emits a ``world_state_delta``
    with no validated turn (the structured-response mock returns only a line,
    not a TurnProposal.action), so the reducer commits zero facts and the
    saved board must equal the seed (minus any locale-enrichment, which the
    seed board does not need since it is English-anchored).
    """
    board = new_session_board(session_id="sess-board-2", era="s3_mid")
    seed_fact_count = len(board["shared_facts"])
    seed_updated_at = board["updated_at_beat"]
    plan = json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Walter White",
                    "content": "DRAFT",
                    "emotion_state": "calm",
                    "gif_search_query": "x",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
            {
                "type": "world_state_delta",
                "data": {
                    "deltas": [
                        {
                            "target": "Walter White",
                            "field": "mood",
                            "old_value": "cold",
                            "new_value": "openly furious",
                        }
                    ]
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
        ]
    )
    mock_provider.call_model = AsyncMock(return_value=plan)
    saved: list[dict] = []

    async def fake_save(session_factory, session_id, board_out):
        saved.append(board_out)

    async def fake_structured(self, *args, **kwargs):
        return {
            "reply_text": "Walt line",
            "emotion_state": "angry",
            "gif_search_query": "angry",
            "thinking": None,
            "tool_executed": None,
            "tool_log": None,
        }

    with patch(
        "agents.continuity_board.load_or_init_session_board",
        new=AsyncMock(return_value=board),
    ), patch(
        "agents.continuity_board.save_session_board",
        new=fake_save,
    ), patch(
        "agents.director.update_dossiers",
        new=AsyncMock(return_value=None),
    ), patch(
        "agents.characters.base.BaseCharacter.respond_structured",
        new=fake_structured,
    ):
        async for _ in director._generate_beat(
            task="t",
            outline="1. Lab",
            beat_index=3,
            context={"previous_scene": "", "current_scene": "Lab"},
            scene_desc="Lab",
            session_factory=None,
            session_id="sess-board-2",
        ):
            pass

    # Board is still saved (the save path runs), but no LLM-emitted fact
    # landed. The reducer may legitimately commit a "said: ..." fact because
    # the validated turn has a non-empty `line` ("Walt line"); that is the
    # sole writer path (DEC-0005 P4). The LLM world_state_delta payload
    # (mood -> openly furious) is advisory and MUST NOT appear in the saved
    # board.
    assert saved, "board must be saved after beat"

    saved_facts = saved[0]["shared_facts"]
    saved_fact_texts = [f.get("text", "") for f in saved_facts]

    # The LLM delta's signature text is NOT present.
    assert not any("openly furious" in t for t in saved_fact_texts), (
        "LLM-emitted world_state_delta must NOT land on the board "
        "(DEC-0005 P4 sole-writer): " + str(saved_fact_texts)
    )
    # The reducer's deterministic "said: ..." fact IS present.
    assert any("Walt line" in t for t in saved_fact_texts), (
        "Reducer-written 'said: ...' fact must be present: " + str(saved_fact_texts)
    )

    # Seed sanity: every seed fact id is still in the saved board.
    seed_ids = {f["id"] for f in board["shared_facts"]}
    saved_ids = {f["id"] for f in saved_facts}
    assert seed_ids.issubset(saved_ids)


@pytest.mark.asyncio
async def test_s1_board_injects_walter_intelligence_pack(director, mock_provider):
    """S1 era board must inject Character Intelligence Pack into Walter only."""
    board = new_session_board(session_id="sess-s1-intel", era="s1_early", location="driveway")
    plan = json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Walter White",
                    "content": "DRAFT_WALT",
                    "emotion_state": "tense",
                    "gif_search_query": "walt tense",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Jesse Pinkman",
                    "content": "DRAFT_JESSE",
                    "emotion_state": "tense",
                    "gif_search_query": "jesse tense",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
        ]
    )
    mock_provider.call_model = AsyncMock(return_value=plan)
    captured: list[dict] = []

    async def fake_structured(
        self,
        context,
        user_message,
        model_route="x",
        voice_example=None,
        dossier_context=None,
        **kwargs,
    ):
        captured.append(
            {
                "name": self.name,
                "dossier_context": dossier_context or "",
            }
        )
        return {
            "reply_text": f"{self.name} spoken",
            "emotion_state": "tense",
            "gif_search_query": "face",
            "thinking": None,
            "action": {"verb": "look_at", "target_id": "jesse"},
            "tool_executed": None,
            "tool_log": None,
        }

    with patch(
        "agents.continuity_board.load_or_init_session_board",
        new=AsyncMock(return_value=board),
    ), patch(
        "agents.continuity_board.save_session_board",
        new=AsyncMock(),
    ), patch(
        "agents.director.update_dossiers",
        new=AsyncMock(return_value=None),
    ), patch(
        "agents.characters.base.BaseCharacter.respond_structured",
        new=fake_structured,
    ):
        async for _ in director._generate_beat(
            task="Argue about quitting",
            outline="1. Driveway",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "Driveway"},
            scene_desc="Driveway",
            session_factory=None,
            session_id="sess-s1-intel",
        ):
            pass

    assert len(captured) == 2
    walt = next(c for c in captured if c["name"] == "Walter White")
    jesse = next(c for c in captured if c["name"] == "Jesse Pinkman")
    assert "CHARACTER INTELLIGENCE PACK" in walt["dossier_context"]
    assert "era_family=s1" in walt["dossier_context"]
    assert "enough money" in walt["dossier_context"].lower() or "Money / exit" in walt[
        "dossier_context"
    ]
    # No jesse pack yet — intelligence header must not appear for Jesse
    assert "CHARACTER INTELLIGENCE PACK" not in jesse["dossier_context"]


def test_format_board_prompt_is_play_not_courtroom():
    board = new_session_board(session_id="s", era="s3_mid")
    view = filter_board_for_character(board, "walter")
    text = format_board_prompt(view, character_id="walter")
    assert "Play freely" in text
    assert "court" not in text.lower()
    assert "true vs false" not in text.lower()
