"""Identity contract: unknown / unwired ids must not become Walter White.

Marie is not a director-playable character. Selecting or sending `marie`
must not silently speak as Walter. Unknown character_id must reject.
"""

from __future__ import annotations

import json
import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.director import (
    CHARACTER_AGENTS,
    FRONTEND_TO_BACKEND_ID,
    UnknownCharacterId,
    crew_participants_from_message,
    require_backend_character_id,
    resolve_backend_character_id,
    DirectorAgent,
)
from agents.provider import ModelResult


def _director() -> tuple[DirectorAgent, list]:
    captured: list = []

    async def _tools(messages, *args, **kwargs):
        captured.append(messages)
        return ModelResult(
            content=json.dumps({
                "reply_text": "I am the one who knocks.",
                "emotion_state": "tense",
                "gif_search_query": "walter white tense",
                "thinking": "He does not know who I am.",
                "tool_executed": None,
                "tool_log": None,
            }),
            tool_calls=[],
            stop_reason="end_turn",
        )

    provider = MagicMock()
    provider.call_model = AsyncMock(return_value="ok")
    provider.call_model_with_tools = AsyncMock(side_effect=_tools)
    provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")
    return DirectorAgent(provider=provider), captured


def test_marie_is_not_mapped_to_walter_white():
    """marie is not a director-playable id and must not become Walter White."""
    assert "marie" not in FRONTEND_TO_BACKEND_ID
    assert FRONTEND_TO_BACKEND_ID.get("marie") is None
    with pytest.raises(UnknownCharacterId):
        require_backend_character_id("marie")
    assert resolve_backend_character_id("marie") is None


@pytest.mark.parametrize(
    "raw",
    ["heisenberg", "tuco", "not-a-character", "unknown_npc", ""],
)
def test_unknown_character_id_does_not_map_to_walter(raw: str):
    with pytest.raises(UnknownCharacterId):
        require_backend_character_id(raw)
    resolved = resolve_backend_character_id(raw or None)
    assert resolved != "Walter White"
    assert resolved not in CHARACTER_AGENTS


def test_known_playable_ids_still_resolve():
    assert require_backend_character_id("walter") == "Walter White"
    assert require_backend_character_id("hank") == "Hank Schrader"
    assert require_backend_character_id("Jesse Pinkman") == "Jesse Pinkman"


async def test_direct_chat_marie_does_not_speak_as_walter():
    director, captured = _director()
    with pytest.raises(UnknownCharacterId):
        await director.handle_chat_message(
            character_id="marie",
            user_message="How is Skyler?",
            context={
                "mode": "direct",
                "relation": "family member",
                "language": "en",
                "history": [],
                "llmProvider": "stepfun",
            },
        )
    assert captured == []


async def test_direct_chat_unknown_id_does_not_speak_as_walter():
    director, captured = _director()
    with pytest.raises(UnknownCharacterId):
        await director.handle_chat_message(
            character_id="heisenberg",
            user_message="Say my name.",
            context={
                "mode": "direct",
                "relation": "partner",
                "language": "en",
                "history": [],
                "llmProvider": "stepfun",
            },
        )
    assert captured == []


def test_crew_marie_primary_is_not_walter():
    with pytest.raises(UnknownCharacterId):
        crew_participants_from_message("marie", "hello")


def test_crew_unknown_primary_is_not_walter():
    with pytest.raises(UnknownCharacterId):
        crew_participants_from_message("not-a-character", "hello")


async def test_chat_endpoint_rejects_marie_with_400():
    from api.routes import ChatRequest, chat
    from fastapi import HTTPException

    director, captured = _director()
    payload = ChatRequest(characterId="marie", userInput="How is Skyler?")
    fake_request = MagicMock()
    fake_request.client = MagicMock(host="127.0.0.1")
    fake_request.headers = {}

    with pytest.raises(HTTPException) as exc_info:
        await chat(request=fake_request, payload=payload, director=director)

    assert exc_info.value.status_code == 400
    assert "marie" in str(exc_info.value.detail).lower()
    assert captured == []


async def test_chat_endpoint_rejects_unknown_id_with_400():
    from api.routes import ChatRequest, chat
    from fastapi import HTTPException

    director, captured = _director()
    payload = ChatRequest(characterId="heisenberg", userInput="Say my name.")
    fake_request = MagicMock()
    fake_request.client = MagicMock(host="127.0.0.1")
    fake_request.headers = {}

    with pytest.raises(HTTPException) as exc_info:
        await chat(request=fake_request, payload=payload, director=director)

    assert exc_info.value.status_code == 400
    assert captured == []
