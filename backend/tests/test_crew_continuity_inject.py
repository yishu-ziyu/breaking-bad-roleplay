"""Crew: each speaker's full model input is their own ActorView, not a shared dump."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.director import DirectorAgent
from agents.provider import ModelResult, ProviderFacade


def _reply(cid: str, line: str) -> ModelResult:
    return ModelResult(
        content=json.dumps(
            {
                "reply_text": line,
                "emotion_state": "tense",
                "gif_search_query": "x",
                "thinking": None,
                "action": {"verb": "idle_tense"},
                "tool_executed": None,
                "tool_log": None,
            }
        ),
        tool_calls=[],
        stop_reason="end_turn",
    )


@pytest.fixture
def mock_provider():
    provider = MagicMock(spec=ProviderFacade)
    provider.resolve_model_route.return_value = "stepfun/step-3.7-flash"
    provider.call_model = AsyncMock(return_value="[]")
    provider.call_model_with_tools = AsyncMock(
        return_value=_reply("Walter White", "We stay precise.")
    )
    provider.cli_proxy_default_model = "gpt-5.4"
    return provider


@pytest.fixture
def director(mock_provider):
    return DirectorAgent(mock_provider, enable_dossier_updates=False)


@pytest.mark.asyncio
async def test_crew_each_speaker_sees_only_own_board(director, mock_provider):
    captured: list[list] = []

    async def _tools(messages, *args, **kwargs):
        captured.append(messages)
        blob = json.dumps(messages, ensure_ascii=False)
        if "Jesse Pinkman" in blob or "You are Jesse" in blob:
            return _reply("Jesse Pinkman", "Yeah, whatever.")
        return _reply("Walter White", "We stay precise.")

    mock_provider.call_model_with_tools = AsyncMock(side_effect=_tools)
    context = {
        "mode": "crew",
        "history": [],
        "language": "en",
        "relation": "partner",
        "llmProvider": "stepfun",
    }
    result = await director._handle_crew_chat(
        "walter", "Jesse, what's the plan with Gus?", context
    )
    assert result["debate_logs"]
    assert len(captured) >= 2

    def _blob(msgs: list) -> str:
        return json.dumps(msgs, ensure_ascii=False)

    walter_in = next(b for b in captured if "You are Walter White" in _blob(b) or "Walter White" in _blob(b)[:800])
    jesse_in = next(b for b in captured if "You are Jesse Pinkman" in _blob(b))
    jesse_blob = _blob(jesse_in)
    walter_blob = _blob(walter_in)
    assert "household story is incomplete" not in jesse_blob
    assert "Gus" in jesse_blob or "cook" in jesse_blob.lower() or "PLAYER RELATION" in walter_blob
    # Full input — not a sliced CHARACTER VOICE block — is what isolation means.
    assert "CHARACTER VOICE GUIDES" not in jesse_blob
    assert "CHARACTER VOICE GUIDES" not in walter_blob


@pytest.mark.asyncio
async def test_crew_skyler_input_hides_gus_roof(director, mock_provider):
    captured: list[list] = []

    async def _tools(messages, *args, **kwargs):
        captured.append(messages)
        return _reply("Skyler White", "I need the truth about this house.")

    mock_provider.call_model_with_tools = AsyncMock(side_effect=_tools)
    context = {
        "mode": "crew",
        "history": [],
        "language": "en",
        "relation": "family member",
        "llmProvider": "stepfun",
    }
    await director._handle_crew_chat("skyler", "Skyler wants answers", context)
    assert captured
    sky_blob = json.dumps(captured[0], ensure_ascii=False)
    assert "under Gus Fring's organization" not in sky_blob
    assert "family member" in sky_blob
    assert "CHARACTER VOICE GUIDES" not in sky_blob
