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

    async def fake_structured(self, context, user_message, model_route="x", voice_example=None, dossier_context=None):
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
async def test_board_deltas_saved_after_beat(director, mock_provider):
    board = new_session_board(session_id="sess-board-2", era="s3_mid")
    before = len(board["shared_facts"])
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

    assert saved, "board must be saved after beat"
    assert len(saved[0]["shared_facts"]) >= before + 1
    assert saved[0]["updated_at_beat"] == 3


def test_format_board_prompt_is_play_not_courtroom():
    board = new_session_board(session_id="s", era="s3_mid")
    view = filter_board_for_character(board, "walter")
    text = format_board_prompt(view, character_id="walter")
    assert "Play freely" in text
    assert "court" not in text.lower()
    assert "true vs false" not in text.lower()
