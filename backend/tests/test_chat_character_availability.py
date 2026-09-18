"""T4: chat character availability — Marie is playable, unknown ids fail loudly.

Given a chat request naming a character the director does not know,
When /api/chat or DirectorAgent.handle_chat_message handles it,
Then it must fail with an explicit ``unknown_character`` error (client code +
server log) instead of silently answering as Walter White.

And given the UI offers Marie (App.tsx CharacterId includes ``marie``),
When a direct or crew chat names her,
Then her own character policy answers — not Walter's.
"""

from __future__ import annotations

import json
import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.director import (
    CHARACTER_AGENTS,
    FRONTEND_TO_BACKEND_ID,
    DirectorAgent,
    UnknownCharacterError,
    crew_participants_from_message,
    resolve_playable_character_id,
)


def _ok_reply() -> str:
    return json.dumps({
        "reply_text": "Hello, it's me.",
        "emotion_state": "calm",
        "gif_search_query": None,
        "thinking": None,
        "tool_executed": None,
        "tool_log": None,
    })


def _capturing_director() -> tuple[DirectorAgent, list]:
    captured: list = []

    async def _call(messages, *args, **kwargs):
        captured.append(messages)
        return _ok_reply()

    provider = MagicMock()
    provider.call_model = AsyncMock(side_effect=_call)
    provider.call_model_with_tools = AsyncMock(
        side_effect=AssertionError("lean chat must not use tools")
    )
    provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")
    return DirectorAgent(provider=provider), captured


# ---------------------------------------------------------------------------
# Unknown ids must fail explicitly — never fall back to Walter
# ---------------------------------------------------------------------------

def test_resolve_playable_character_id_rejects_unknown_with_code():
    with pytest.raises(UnknownCharacterError) as exc:
        resolve_playable_character_id("gomez")
    assert exc.value.code == "unknown_character"
    assert "gomez" in str(exc.value)


@pytest.mark.parametrize("mode", ["direct", "crew"])
async def test_handle_chat_message_rejects_unknown_character(mode):
    director, captured = _capturing_director()
    with pytest.raises(UnknownCharacterError):
        await director.handle_chat_message("gomez", "Who are you?", {"mode": mode})
    assert captured == [], "no model call may run for an unknown character"


def test_crew_participants_reject_unknown_primary():
    with pytest.raises(UnknownCharacterError):
        crew_participants_from_message("gomez", "say something")


async def test_chat_route_rejects_unknown_character_with_code():
    from fastapi import HTTPException

    from api.routes import ChatRequest, chat

    director, captured = _capturing_director()
    payload = ChatRequest(characterId="gomez", userInput="Hello?")
    fake_request = MagicMock()
    fake_request.client = MagicMock(host="127.0.0.1")
    fake_request.headers = {}

    quota = AsyncMock(return_value=MagicMock(cost=1))
    with patch("api.routes._require_platform_quota", quota), pytest.raises(HTTPException) as exc:
        await chat(request=fake_request, payload=payload, director=director)

    assert exc.value.status_code == 400
    detail = exc.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "unknown_character"
    assert detail["characterId"] == "gomez"
    # Invalid ids must not consume quota.
    quota.assert_not_awaited()
    assert captured == []


# ---------------------------------------------------------------------------
# Marie is wired end-to-end (option A)
# ---------------------------------------------------------------------------

def test_marie_wired_into_director_maps():
    assert FRONTEND_TO_BACKEND_ID["marie"] == "Marie Schrader"
    assert CHARACTER_AGENTS["Marie Schrader"].__name__ == "MarieSchrader"


def test_marie_policy_compiles_to_marie_not_walter():
    from agents.character_policy import compile_character_policy

    policy = compile_character_policy("Marie Schrader")
    assert policy.actor_id == "marie"
    assert "You are Marie Schrader" in policy.core_prompt


def test_crew_mentions_pull_marie():
    assert crew_participants_from_message("marie", "hello")[0] == "Marie Schrader"
    assert "Marie Schrader" in crew_participants_from_message(
        "walter", "ask marie what she saw"
    )
    assert "Marie Schrader" in crew_participants_from_message("walter", "玛丽知道吗？")


async def test_direct_chat_with_marie_uses_marie_policy_not_walter():
    director, captured = _capturing_director()
    result = await director.handle_chat_message(
        character_id="marie",
        user_message="The kitchen looks nice.",
        context={
            "mode": "direct",
            "relation": "Skyler sister-in-law",
            "language": "en",
            "history": [],
            "llmProvider": "stepfun",
        },
    )
    assert result["reply_text"] == "Hello, it's me."
    assert captured, "Marie's turn must reach the model"
    blob = json.dumps(captured[0], ensure_ascii=False)
    assert "You are Marie Schrader" in blob
    assert "You are Walter White" not in blob


async def test_crew_chat_with_marie_returns_marie_line():
    director, captured = _capturing_director()
    result = await director.handle_chat_message(
        character_id="marie",
        user_message="What did you see at the house?",
        context={
            "mode": "crew",
            "relation": "neighbor",
            "language": "en",
            "history": [],
            "llmProvider": "stepfun",
        },
    )
    assert result["participants"][0] == "marie"
    assert result["debate_logs"][0]["sender"] == "marie"
    assert captured
    blob = json.dumps(captured[0], ensure_ascii=False)
    assert "You are Marie Schrader" in blob
