"""PR2: one compiled policy, ActorView, Direct relation + session isolation."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.character_policy import compile_actor_view, compile_character_policy
from agents.director import DirectorAgent
from agents.provider import ModelResult


def _ok_reply(line: str = "Sit down.") -> str:
    return json.dumps(
        {
            "reply_text": line,
            "emotion_state": "tense",
            "gif_search_query": "walter tense",
            "thinking": "Keep control.",
            "tool_executed": None,
            "tool_log": None,
        }
    )


def test_policy_version_is_stable_across_play_modes():
    direct = compile_character_policy("walter", era="s1", play_mode="direct")
    crew = compile_character_policy("walter", era="s1", play_mode="crew")
    story = compile_character_policy("walter", era="s1", play_mode="story")
    assert direct.version == crew.version == story.version
    assert direct.version
    assert direct.core_prompt
    assert "IDENTITY" in direct.core_prompt


def test_era_overlay_changes_version_but_not_core():
    s1 = compile_character_policy("walter", era="s1")
    none = compile_character_policy("walter", era="")
    assert s1.core_prompt == none.core_prompt
    if s1.era_overlay or none.era_overlay:
        assert s1.version != none.version or s1.era_overlay == none.era_overlay


def test_actor_view_includes_relation_and_session():
    view = compile_actor_view(
        "hank",
        relation="family member",
        session_id="sess-a",
        play_mode="direct",
        visible_facts=["Marie bought another purple thing."],
        audience_ids=["marie"],
    )
    block = view.prompt_block()
    assert "family member" in block
    assert "sess-a" not in block  # session id is routing, not player-facing prompt
    assert "Marie bought another purple thing." in block
    assert view.policy.actor_id == "hank"
    assert view.session_id == "sess-a"


@pytest.mark.asyncio
async def test_direct_chat_injects_relation_into_model_input():
    captured: list = []

    async def _tools(messages, *args, **kwargs):
        captured.append(messages)
        return ModelResult(content=_ok_reply(), tool_calls=[], stop_reason="end_turn")

    provider = MagicMock()
    provider.call_model = AsyncMock(return_value=_ok_reply())
    provider.call_model_with_tools = AsyncMock(side_effect=_tools)
    provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")
    director = DirectorAgent(provider=provider)

    await director.handle_chat_message(
        character_id="walter",
        user_message="The money is enough. Stop.",
        context={
            "mode": "direct",
            "relation": "family member",
            "language": "en",
            "history": [],
            "llmProvider": "stepfun",
        },
    )
    blob = json.dumps(provider.call_model.await_args.args[0], ensure_ascii=False)
    assert "family member" in blob
    assert "PLAYER RELATION" in blob


@pytest.mark.asyncio
async def test_direct_session_a_facts_do_not_enter_session_b():
    captured: list = []

    async def _tools(messages, *args, **kwargs):
        captured.append(messages)
        return ModelResult(content=_ok_reply(), tool_calls=[], stop_reason="end_turn")

    provider = MagicMock()
    provider.call_model = AsyncMock(return_value=_ok_reply())
    provider.call_model_with_tools = AsyncMock(side_effect=_tools)
    provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")
    director = DirectorAgent(provider=provider)

    secret = "Session A only: the laundry is a front for the superlab."

    async def _load(_factory, session_id, **kwargs):
        if session_id == "sess-a":
            return {
                "present_cast": ["walter"],
                "shared_facts": [
                    {
                        "id": "a1",
                        "text": secret,
                        "known_by": ["walter"],
                        "hidden_from": [],
                    }
                ],
            }
        return {"present_cast": ["walter"], "shared_facts": []}

    from unittest.mock import patch

    with patch(
        "agents.continuity_board.load_or_init_session_board",
        new=AsyncMock(side_effect=_load),
    ):
        await director.handle_chat_message(
            character_id="walter",
            user_message="What is going on?",
            context={
                "mode": "direct",
                "relation": "partner",
                "language": "en",
                "history": [],
                "llmProvider": "stepfun",
                "sessionId": "sess-b",
            },
            session_factory=object(),
        )

    blob = json.dumps(captured, ensure_ascii=False)
    assert secret not in blob
