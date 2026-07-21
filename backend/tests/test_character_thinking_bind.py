"""Character-agent thinking must drive agent_think in Story beats."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.director import DirectorAgent, apply_character_thinking
from agents.provider import ModelResult
from models.schemas import AgentEvent


def _mr(text: str) -> ModelResult:
    return ModelResult(content=text, tool_calls=[], stop_reason="end_turn")


class TestApplyCharacterThinking:
    def test_overwrites_prior_think_same_character(self):
        events = [
            {
                "type": "agent_think",
                "data": {
                    "character_id": "Walter White",
                    "thought_content": "DIRECTOR_GENERIC_THOUGHT",
                },
            },
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Walter White",
                    "content": "draft",
                },
            },
        ]
        out = apply_character_thinking(
            events,
            "Walter White",
            "They will never see me coming.",
            speak_index=1,
        )
        thinks = [e for e in out if e["type"] == "agent_think"]
        assert len(thinks) == 1
        assert thinks[0]["data"]["thought_content"] == "They will never see me coming."
        assert out[1]["type"] == "agent_speak"

    def test_inserts_think_when_missing(self):
        events = [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Jesse Pinkman",
                    "content": "Yo.",
                    "recommended_model": "stepfun/step-3.7-flash",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
        ]
        out = apply_character_thinking(
            events,
            "Jesse Pinkman",
            "This is all wrong, man.",
            speak_index=0,
        )
        assert out[0]["type"] == "agent_think"
        assert out[0]["data"]["thought_content"] == "This is all wrong, man."
        assert out[0]["data"]["character_id"] == "Jesse Pinkman"
        assert out[1]["type"] == "agent_speak"
        assert out[0].get("recommended_model") == "stepfun/step-3.7-flash"

    def test_does_not_touch_other_character_think(self):
        events = [
            {
                "type": "agent_think",
                "data": {
                    "character_id": "Saul Goodman",
                    "thought_content": "Billable hours.",
                },
            },
            {
                "type": "agent_speak",
                "data": {"character_id": "Walter White", "content": "Hi."},
            },
        ]
        out = apply_character_thinking(
            events,
            "Walter White",
            "I am in control.",
            speak_index=1,
        )
        assert out[0]["data"]["thought_content"] == "Billable hours."
        assert out[1]["type"] == "agent_think"
        assert out[1]["data"]["character_id"] == "Walter White"
        assert out[2]["type"] == "agent_speak"

    def test_empty_thinking_noop(self):
        events = [
            {"type": "agent_speak", "data": {"character_id": "Mike Ehrmantraut", "content": "No."}},
        ]
        out = apply_character_thinking(events, "Mike Ehrmantraut", "  ", speak_index=0)
        assert len(out) == 1
        assert out[0]["type"] == "agent_speak"


@pytest.fixture
def director():
    provider = MagicMock()
    return DirectorAgent(provider=provider)


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    return db


class TestCharacterThinkingInBeat:
    async def test_sub_agent_thinking_replaces_director_think(
        self, director, mock_db
    ):
        plan = json.dumps([
            {
                "type": "agent_think",
                "data": {
                    "character_id": "Walter White",
                    "thought_content": "DIRECTOR_THOUGHT",
                },
            },
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Walter White",
                    "content": "DIRECTOR_LINE",
                    "emotion_state": "calm",
                    "gif_search_query": "walter calm",
                },
            },
        ])
        sub = json.dumps({
            "reply_text": "I am the danger.",
            "emotion_state": "manipulative",
            "gif_search_query": "walter white danger",
            "thinking": "They still think I am a high-school teacher.",
            "tool_executed": None,
            "tool_log": None,
        })
        director.provider.call_model = AsyncMock(return_value=plan)
        director.provider.call_model_with_tools = AsyncMock(return_value=_mr(sub))
        director.provider.resolve_model_route = MagicMock(
            return_value="stepfun/step-3.7-flash"
        )

        collected: list[AgentEvent] = []
        with patch("agents.director.update_dossiers", new=AsyncMock(return_value=None)):
            async for ev in director._generate_beat(
                task="t",
                outline="1. RV",
                beat_index=0,
                context={"previous_scene": "", "current_scene": "RV"},
                db=mock_db,
                session_id="sess-think",
                language="en",
            ):
                collected.append(ev)

        thinks = [e for e in collected if e.type == "agent_think"]
        speaks = [e for e in collected if e.type == "agent_speak"]
        assert len(thinks) == 1
        assert thinks[0].data["thought_content"] == (
            "They still think I am a high-school teacher."
        )
        assert "DIRECTOR_THOUGHT" not in (thinks[0].data.get("thought_content") or "")
        assert speaks[0].data["content"] == "I am the danger."
        # think before speak in stream order
        think_i = next(i for i, e in enumerate(collected) if e.type == "agent_think")
        speak_i = next(i for i, e in enumerate(collected) if e.type == "agent_speak")
        assert think_i < speak_i

    async def test_sub_agent_thinking_inserted_when_no_director_think(
        self, director, mock_db
    ):
        plan = json.dumps([
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Jesse Pinkman",
                    "content": "yo",
                    "emotion_state": "tense",
                    "gif_search_query": "jesse nervous",
                },
            },
        ])
        sub = json.dumps({
            "reply_text": "This is messed up, yo.",
            "emotion_state": "fearful",
            "gif_search_query": "jesse pinkman scared",
            "thinking": "Mr. White is going to get us killed.",
            "tool_executed": None,
            "tool_log": None,
        })
        director.provider.call_model = AsyncMock(return_value=plan)
        director.provider.call_model_with_tools = AsyncMock(return_value=_mr(sub))
        director.provider.resolve_model_route = MagicMock(
            return_value="stepfun/step-3.7-flash"
        )

        collected: list[AgentEvent] = []
        with patch("agents.director.update_dossiers", new=AsyncMock(return_value=None)):
            async for ev in director._generate_beat(
                task="t",
                outline="1. desert",
                beat_index=0,
                context={"previous_scene": "", "current_scene": "desert"},
                db=mock_db,
                session_id="sess-think2",
                language="en",
            ):
                collected.append(ev)

        thinks = [e for e in collected if e.type == "agent_think"]
        speaks = [e for e in collected if e.type == "agent_speak"]
        assert len(thinks) == 1
        assert "killed" in thinks[0].data["thought_content"]
        assert speaks[0].data["content"] == "This is messed up, yo."
        assert collected.index(thinks[0]) < collected.index(speaks[0])
