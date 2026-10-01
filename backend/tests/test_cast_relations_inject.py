"""Inject relevant CAST RELATIONS rows into Direct, Crew, and Story (issue #81).

Given a speaker and people who are present or mentioned,
When that speaker's prompt is assembled,
Then the model sees the matching table subset — and crew copy must not
imply that non-household characters share the player's household.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.character_policy import compile_actor_view
from agents.director import DirectorAgent
from agents.provider import ModelResult, ProviderFacade
from models.schemas import AgentEvent


def _ok_reply(line: str = "Yeah.") -> str:
    return json.dumps(
        {
            "reply_text": line,
            "emotion_state": "tense",
            "gif_search_query": "tense",
            "thinking": "Keep it small.",
            "action": {"verb": "idle_tense"},
            "tool_executed": None,
            "tool_log": None,
        }
    )


def _provider_capturing(captured: list) -> MagicMock:
    async def _call(messages, *args, **kwargs):
        captured.append(messages)
        return _ok_reply()

    async def _tools(messages, *args, **kwargs):
        captured.append(messages)
        return ModelResult(content=_ok_reply(), tool_calls=[], stop_reason="end_turn")

    provider = MagicMock(spec=ProviderFacade)
    provider.resolve_model_route.return_value = "stepfun/step-3.7-flash"
    provider.call_model = AsyncMock(side_effect=_call)
    provider.call_model_with_tools = AsyncMock(side_effect=_tools)
    provider.cli_proxy_default_model = "gpt-5.4"
    return provider


def test_actor_view_injects_mentioned_rows():
    view = compile_actor_view(
        "jesse",
        relation="partner",
        play_mode="direct",
        mention_text="What if Hank finds out?",
    )
    block = view.prompt_block()
    assert "CAST RELATIONS" in block
    assert "Hank" in block
    assert "DEA" in block or "dea" in block.lower()


def test_actor_view_injects_present_audience_rows():
    view = compile_actor_view(
        "jesse",
        relation="crew peer",
        play_mode="crew",
        audience_ids=["walter"],
        mention_text="",
    )
    block = view.prompt_block()
    assert "CAST RELATIONS" in block
    assert "Mr. White" in block


def test_crew_actor_view_scopes_player_to_primary_only():
    view = compile_actor_view(
        "jesse",
        relation="crew peer",
        play_mode="crew",
        primary_id="walter",
        primary_relation="family member",
        mention_text="汉克要是知道了怎么办？",
        audience_ids=["walter", "jesse"],
    )
    block = view.prompt_block()
    assert "only" in block.lower()
    assert "family member" in block
    assert "CAST RELATIONS" in block
    assert "do not invent" in block.lower()


@pytest.mark.asyncio
async def test_direct_chat_injects_mentioned_cast_row():
    """Given a DM that names an absent person, When Jesse answers, Then Hank's row is in the prompt."""
    captured: list = []
    director = DirectorAgent(_provider_capturing(captured), enable_dossier_updates=False)
    await director.handle_chat_message(
        "jesse",
        "汉克要是知道了怎么办？",
        {
            "mode": "direct",
            "relation": "partner",
            "language": "zh",
            "history": [],
            "llmProvider": "stepfun",
        },
    )
    blob = json.dumps(captured, ensure_ascii=False)
    assert "CAST RELATIONS" in blob
    assert "Hank" in blob or "汉克" in blob
    assert "DEA" in blob or "dea" in blob.lower()


@pytest.mark.asyncio
async def test_crew_chat_injects_rows_and_primary_only_player_scope():
    """Given crew with Walter as the player's family member,
    When Jesse is asked about Hank,
    Then Jesse sees Hank's row and is told the player belongs only to Walter.
    """
    captured: list = []
    director = DirectorAgent(_provider_capturing(captured), enable_dossier_updates=False)
    await director.handle_chat_message(
        "walter",
        "杰西，汉克要是知道了怎么办？",
        {
            "mode": "crew",
            "relation": "family member",
            "language": "zh",
            "history": [],
            "llmProvider": "stepfun",
        },
    )
    blob = json.dumps(captured, ensure_ascii=False)
    assert "CAST RELATIONS" in blob
    assert "only" in blob.lower()
    assert "family member" in blob
    assert "do not invent" in blob.lower()
    # Jesse is pulled in by name; his subset must include Hank.
    assert "Hank" in blob or "汉克" in blob


@pytest.mark.asyncio
async def test_story_beat_injects_cast_rows_for_present_and_mentioned():
    """Given a scene with Jesse speaking and Hank named in the task,
    When the story beat assembles his dossier,
    Then the Hank row is injected.
    """
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
                "user_message": user_message,
            }
        )
        return {
            "reply_text": f"{self.name} spoken",
            "emotion_state": "tense",
            "gif_search_query": "face",
            "thinking": None,
            "action": {"verb": "look_at", "target_id": "walter"},
            "tool_executed": None,
            "tool_log": None,
        }

    plan = json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Jesse Pinkman",
                    "content": "DRAFT",
                    "emotion_state": "tense",
                    "gif_search_query": "jesse",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
            {
                "type": "world_state_delta",
                "data": {"deltas": []},
                "recommended_model": "stepfun/step-3.7-flash",
            },
        ]
    )
    provider = MagicMock(spec=ProviderFacade)
    provider.resolve_model_route.return_value = "stepfun/step-3.7-flash"
    provider.call_model = AsyncMock(return_value=plan)
    provider.call_model_with_tools = AsyncMock()
    director = DirectorAgent(provider, enable_dossier_updates=False)

    with patch(
        "agents.continuity_board.load_or_init_session_board",
        new=AsyncMock(
            return_value={
                "present_cast": ["jesse", "walter"],
                "shared_facts": [],
                "location": "White house driveway",
            }
        ),
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
            task="Jesse worries what Hank will do if he finds out.",
            outline="1. Driveway - Hank named, not present",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "White house driveway"},
            scene_desc="White house driveway — Hank is at a cookout next door",
            session_factory=None,
            session_id="sess-rel-1",
        ):
            events.append(ev)

    assert captured
    jesse = next(c for c in captured if c["name"] == "Jesse Pinkman")
    blob = jesse["dossier_context"] + "\n" + jesse["user_message"]
    assert "CAST RELATIONS" in blob
    assert "Hank" in blob
    assert "DEA" in blob or "dea" in blob.lower()
