"""Rejected character turns: bounded same-beat regeneration + reason codes (T12).

Incident (2026-09-18): a cold-open desert beat sometimes failed with
``no_accepted_character_turn``. The planner had answered the beat with
narration/acts only, or wrote the player's own line; the publish gate dropped
it, the beat produced no character ``agent_speak``, and the player lost the
whole turn with only "重试这一拍".

Contract under test:
1. A plan with no publishable character speak is regenerated once inside the
   same beat, with a correction that names who may speak; the beat then
   succeeds and the retry is logged with its reason.
2. Regeneration is bounded: one extra plan call, never a loop.
3. ``render_turn`` refuses a speak-less beat with ``StoryTurnRejected`` carrying
   code / retryable / detail, and logs which events/characters were refused
   and why (planner omission vs player-only speech).
4. The SSE error event carries ``code="no_accepted_character_turn"`` and
   ``retryable=True`` so the client can tell it from a transport failure.
"""

from __future__ import annotations

import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from agents.director import DirectorAgent
from api import routes
from db.session import Base, get_db
from main import app
from models.schemas import AgentEvent
from scenes.world_state import seed_world
from story.renderer import StoryTurnRejected, render_turn
from story.service import TurnClaim


def _plan_without_speak() -> str:
    return json.dumps(
        [
            {
                "type": "agent_act",
                "data": {"character_id": "jesse", "action": "look_at"},
                "recommended_model": "stepfun/step-3.7-flash",
            },
            {
                "type": "agent_think",
                "data": {"character_id": "jesse", "thought_content": "He is lying."},
                "recommended_model": "stepfun/step-3.7-flash",
            },
        ]
    )


def _plan_player_speak_only() -> str:
    return json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {"character_id": "walter", "content": "Jesse, stop."},
                "recommended_model": "stepfun/step-3.7-flash",
            },
            {
                "type": "agent_act",
                "data": {"character_id": "walter", "action": "stand"},
                "recommended_model": "stepfun/step-3.7-flash",
            },
        ]
    )


def _plan_with_npc_speak() -> str:
    # Full backend display id: only those run the Character Policy sub-agent.
    return json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Jesse Pinkman",
                    "content": "Who is that? Kill the lights.",
                    "emotion_state": "tense",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            }
        ]
    )


async def _character_reply(**_kwargs):
    return {
        "reply_text": "Who is that? Kill the lights.",
        "emotion_state": "tense",
        "gif_search_query": None,
        "thinking": None,
        "action": {"verb": "idle_tense"},
    }


async def _collect_beat(director) -> list[AgentEvent]:
    with patch(
        "agents.characters.base.BaseCharacter.respond_structured",
        side_effect=_character_reply,
    ):
        return [
            event
            async for event in director._generate_beat(
                task="Cold open",
                outline="1. The desert",
                beat_index=0,
                context={
                    "player_actor_id": "walter",
                    "allowed_actor_ids": ["walter", "jesse"],
                },
                language="en",
                require_character_speak=True,
            )
        ]


# ---------------------------------------------------------------------------
# 1 + 2. Plan without a character line -> one bounded regeneration -> success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_plan_without_any_speak_is_regenerated_once_then_succeeds(
    mock_provider, caplog
):
    director = DirectorAgent(provider=mock_provider)
    mock_provider.call_model = AsyncMock(
        side_effect=[_plan_without_speak(), _plan_with_npc_speak()]
    )

    with caplog.at_level(logging.WARNING, logger="agents.director"):
        events = await _collect_beat(director)

    assert mock_provider.call_model.await_count == 2, (
        "the speak-less plan must be regenerated exactly once"
    )
    assert any(event.type == "agent_speak" for event in events)
    assert not [event for event in events if event.type == "error"]
    # The regeneration asked for a present character by name.
    correction = mock_provider.call_model.await_args_list[1].args[0][1]["content"]
    assert "CORRECTION REQUIRED" in correction
    assert "jesse" in correction
    assert "regenerating once with correction" in caplog.text


@pytest.mark.asyncio
async def test_player_only_speak_is_regenerated_once(mock_provider, caplog):
    """A line written for the player is not a character turn either."""
    director = DirectorAgent(provider=mock_provider)
    mock_provider.call_model = AsyncMock(
        side_effect=[_plan_player_speak_only(), _plan_with_npc_speak()]
    )

    with caplog.at_level(logging.WARNING, logger="agents.director"):
        events = await _collect_beat(director)

    assert mock_provider.call_model.await_count == 2
    speakers = [
        event.data.get("character_id")
        for event in events
        if event.type == "agent_speak"
    ]
    assert speakers and all(speaker != "walter" for speaker in speakers)
    assert "speaker_is_player" in caplog.text


@pytest.mark.asyncio
async def test_regeneration_is_bounded_to_one_extra_plan_call(mock_provider, caplog):
    director = DirectorAgent(provider=mock_provider)
    mock_provider.call_model = AsyncMock(
        side_effect=[_plan_without_speak(), _plan_without_speak()]
    )

    with caplog.at_level(logging.WARNING, logger="agents.director"):
        events = await _collect_beat(director)

    assert mock_provider.call_model.await_count == 2
    assert not any(event.type == "agent_speak" for event in events)
    assert "regeneration still produced no character agent_speak" in caplog.text


@pytest.mark.asyncio
async def test_transient_character_call_is_retried_once_in_same_beat(
    mock_provider, monkeypatch, caplog
):
    """A network blip during the character turn must not lose the speaker.

    2026-09-18: a ``ReadError`` on the Jesse call dropped the only speak and
    the beat failed with ``character_subagent_failed``.
    """
    monkeypatch.setattr("agents.director.BEAT_TRANSIENT_RETRY_BACKOFF_SECONDS", 0.0)
    director = DirectorAgent(provider=mock_provider)
    mock_provider.call_model = AsyncMock(
        side_effect=[
            _plan_with_npc_speak(),
            _plan_with_npc_speak(),
            _plan_with_npc_speak(),
            _plan_with_npc_speak(),
            _plan_with_npc_speak(),
        ]
    )

    replies = AsyncMock(side_effect=[httpx.ReadError("Server disconnected"), await _character_reply()])

    with patch(
        "agents.characters.base.BaseCharacter.respond_structured", new=replies
    ):
        with caplog.at_level(logging.WARNING, logger="agents.director"):
            events = [
                event
                async for event in director._generate_beat(
                    task="Cold open",
                    outline="1. The desert",
                    beat_index=0,
                    context={
                        "player_actor_id": "walter",
                        "allowed_actor_ids": ["walter", "jesse"],
                    },
                    language="en",
                    require_character_speak=True,
                )
            ]

    assert replies.await_count == 2, "the transient character-call failure gets one retry"
    assert any(event.type == "agent_speak" for event in events)
    assert not [event for event in events if event.type == "error"]


@pytest.mark.asyncio
async def test_exhausted_plan_retry_regenerates_once(mock_provider, monkeypatch):
    monkeypatch.setattr("agents.director.BEAT_TRANSIENT_RETRY_BACKOFF_SECONDS", 0.0)
    director = DirectorAgent(provider=mock_provider)
    mock_provider.call_model = AsyncMock(
        side_effect=[
            httpx.ReadError("Server disconnected"),
            httpx.ReadError("Server disconnected"),
            _plan_with_npc_speak(),
        ]
    )

    events = await _collect_beat(director)

    assert mock_provider.call_model.await_count == 3, (
        "plan attempt 1 exhausts its 2 transport tries, then one regeneration"
    )
    assert any(event.type == "agent_speak" for event in events)
    assert not [event for event in events if event.type == "error"]


# ---------------------------------------------------------------------------
# 3. render_turn rejection: code + reasons + log
# ---------------------------------------------------------------------------


def _claim(*, action: str = "start") -> TurnClaim:
    return TurnClaim(
        session_id="s-1",
        command_id="opening",
        revision=0,
        world=seed_world("walter", "desert_crisis"),
        payload={"action": action, "command_id": "opening", "expected_revision": 0},
        task="Cold open",
        outline="1. The desert",
        beat_index=0,
        perspective=None,
    )


def _director_yielding(*events: AgentEvent):
    """Real director with the beat generator stubbed to a fixed event list."""
    director = DirectorAgent(provider=MagicMock())

    async def _fake_generate_beat(**_kwargs):
        for event in events:
            yield event

    director._generate_beat = _fake_generate_beat
    return director


async def _drain(generator) -> None:
    async for _ in generator:
        pass


@pytest.mark.asyncio
async def test_renderer_rejects_speakless_beat_with_code_and_reasons(caplog):
    director = _director_yielding(
        AgentEvent(type="agent_act", data={"character_id": "jesse", "action": "look_at"}),
    )

    with caplog.at_level(logging.WARNING, logger="story.renderer"):
        with pytest.raises(StoryTurnRejected) as excinfo:
            await _drain(render_turn(director, None, _claim()))

    exc = excinfo.value
    assert exc.code == "no_accepted_character_turn"
    assert exc.retryable is True
    detail = json.loads(exc.detail)
    assert detail["reason"] == "planner_emitted_no_character_speak"
    assert detail["player_id"] == "walter"
    assert "jesse" in detail["present"]
    assert "no accepted character turn" in caplog.text
    assert "planner_emitted_no_character_speak" in caplog.text


@pytest.mark.asyncio
async def test_renderer_logs_player_speaker_as_rejection_reason(caplog):
    director = _director_yielding(
        AgentEvent(type="agent_speak", data={"character_id": "walter", "content": "Stop."}),
        AgentEvent(type="agent_act", data={"character_id": "jesse", "action": "look_at"}),
    )

    with caplog.at_level(logging.WARNING, logger="story.renderer"):
        with pytest.raises(StoryTurnRejected) as excinfo:
            await _drain(render_turn(director, None, _claim()))

    exc = excinfo.value
    assert exc.code == "no_accepted_character_turn"
    detail = json.loads(exc.detail)
    assert detail["reason"] == "all_character_speaks_rejected"
    rejected = detail["rejected_events"]
    assert {"type": "agent_speak", "character_id": "walter", "reason": "speaker_is_player"} in rejected
    assert "speaker_is_player" in caplog.text


# ---------------------------------------------------------------------------
# 3b. A character turn dropped by validation is regenerated in the same beat
# ---------------------------------------------------------------------------


async def _character_reply_with_verb(verb: str):
    return {
        "reply_text": "All right.",
        "emotion_state": "tense",
        "gif_search_query": None,
        "thinking": None,
        "action": {"verb": verb},
    }


@pytest.mark.asyncio
async def test_validation_drop_is_recorded_and_regenerated(mock_provider, caplog):
    """A rejected action verb must reach the log/sink, not just vanish.

    Runtime v1 boards refuse world-changing verbs (``unsettled_action``);
    the whole character group is dropped and the beat used to fail.
    """
    director = DirectorAgent(provider=mock_provider)
    mock_provider.call_model = AsyncMock(
        side_effect=[_plan_with_npc_speak()] * 4
    )
    context = {
        "player_actor_id": "walter",
        "allowed_actor_ids": ["walter", "jesse"],
        "board_override": {"authoritative": True, "present_cast": ["walter", "jesse"]},
        "turn_rejection_log": [],
    }

    rejected_reply = AsyncMock(
        side_effect=[await _character_reply_with_verb("walk_to")]
    )
    with patch(
        "agents.characters.base.BaseCharacter.respond_structured", new=rejected_reply
    ):
        with caplog.at_level(logging.WARNING, logger="agents.director"):
            first = [
                event
                async for event in director._generate_beat(
                    task="Cold open",
                    outline="1. The desert",
                    beat_index=0,
                    context=context,
                    language="en",
                    require_character_speak=True,
                )
            ]

    assert not any(event.type == "agent_speak" for event in first)
    rejections = context["turn_rejection_log"]
    assert rejections and rejections[0]["reason"] == "turn_validation_failed"
    codes = {issue["code"] for issue in rejections[0]["issues"]}
    assert "unsettled_action" in codes
    assert "world/turn validation failed" in caplog.text

    # The regenerated attempt with a stage verb is accepted.
    context["turn_rejection_log"] = []
    accepted_reply = AsyncMock(
        side_effect=[await _character_reply_with_verb("idle_tense")]
    )
    with patch(
        "agents.characters.base.BaseCharacter.respond_structured", new=accepted_reply
    ):
        second = [
            event
            async for event in director._generate_beat(
                task="Cold open",
                outline="1. The desert",
                beat_index=0,
                context=context,
                language="en",
                require_character_speak=True,
            )
        ]

    assert any(event.type == "agent_speak" for event in second)
    assert context["turn_rejection_log"] == []


# ---------------------------------------------------------------------------
# 4. Directory failure codes keep flowing through _rejection_error
# ---------------------------------------------------------------------------


def test_rejection_error_keeps_director_code_and_retryable():
    from story.renderer import _rejection_error

    exc = _rejection_error(
        AgentEvent(
            type="error",
            data={
                "code": "character_subagent_failed",
                "retryable": True,
                "message": "beat failed",
            },
        )
    )

    assert isinstance(exc, StoryTurnRejected)
    assert exc.code == "character_subagent_failed"
    assert exc.retryable is True
    # Existing T3 contract: the string form stays stable.
    assert str(exc) == "character_turn_rejected:character_subagent_failed"


# ---------------------------------------------------------------------------
# 5. Stream level: the SSE error event carries code + retryable
# ---------------------------------------------------------------------------


def _story_api_director() -> DirectorAgent:
    director = DirectorAgent(provider=MagicMock())
    director._generate_outline = AsyncMock(return_value="1. Opening\n2. Consequence")
    director._parse_outline = MagicMock(side_effect=lambda text: text.splitlines())
    return director


async def _make_story_api(monkeypatch, director):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def database():
        async with factory() as db:
            yield db

    charge = AsyncMock(
        return_value=SimpleNamespace(byok=False, remaining=95, cost=5)
    )
    monkeypatch.setattr(routes, "async_session_factory", factory)
    monkeypatch.setattr(routes, "_require_platform_quota", charge)
    refund = MagicMock()
    monkeypatch.setattr(routes, "_schedule_quota_refund", refund)
    overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[routes.get_director] = lambda: director
    return engine, overrides


async def _stream_desert_session(client) -> str:
    created = await client.post(
        "/api/session/create",
        json={
            "title": "Test",
            "task_prompt": "Original premise",
            "active_character_id": "walter",
            "scenario_id": "desert_crisis",
            "language": "en",
        },
    )
    assert created.status_code == 200, created.text
    data = created.json()
    path = f"/api/session/{data['session_id']}"
    headers = {"X-Session-Key": data["session_key"]}
    streamed = await client.get(path + "/stream", headers=headers)
    assert streamed.status_code == 200
    return streamed.text


@pytest.fixture
async def speakless_story_api(monkeypatch):
    director = _story_api_director()

    async def _fake_generate_beat(**_kwargs):
        yield AgentEvent(
            type="agent_act", data={"character_id": "jesse", "action": "look_at"}
        )

    director._generate_beat = _fake_generate_beat
    engine, overrides = await _make_story_api(monkeypatch, director)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client
    app.dependency_overrides.clear()
    app.dependency_overrides.update(overrides)
    await engine.dispose()


@pytest.mark.asyncio
async def test_stream_error_event_carries_rejection_code(speakless_story_api):
    streamed_text = await _stream_desert_session(speakless_story_api)

    assert "event: error" in streamed_text
    payload_line = [
        line for line in streamed_text.splitlines()
        if line.startswith("data: ") and "no_accepted_character_turn" in line
    ]
    assert payload_line, streamed_text[-2000:]
    payload = json.loads(payload_line[0][len("data: "):])
    assert payload["data"]["code"] == "no_accepted_character_turn"
    assert payload["data"]["retryable"] is True
    assert json.loads(payload["data"]["detail"])["reason"] == (
        "planner_emitted_no_character_speak"
    )


@pytest.fixture
async def regenerating_story_api(monkeypatch):
    director = _story_api_director()
    calls: list[str] = []

    async def _fake_generate_beat(**kwargs):
        calls.append(str(kwargs.get("task") or ""))
        if len(calls) == 1:
            # Attempt 1: narration only — nothing publishable.
            yield AgentEvent(
                type="agent_act", data={"character_id": "jesse", "action": "look_at"}
            )
            yield AgentEvent(type="beat_ready", data={"beat_index": 0})
            return
        yield AgentEvent(
            type="agent_speak",
            data={
                "character_id": "Jesse Pinkman",
                "content": "Kill the lights.",
                "emotion_state": "tense",
            },
        )
        yield AgentEvent(type="beat_ready", data={"beat_index": 0})

    director._generate_beat = _fake_generate_beat
    engine, overrides = await _make_story_api(monkeypatch, director)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, calls
    app.dependency_overrides.clear()
    app.dependency_overrides.update(overrides)
    await engine.dispose()


@pytest.mark.asyncio
async def test_speakless_attempt_regenerates_and_publishes_same_turn(
    regenerating_story_api,
):
    client, calls = regenerating_story_api

    streamed_text = await _stream_desert_session(client)

    assert "event: error" not in streamed_text, streamed_text[-2000:]
    assert "event: agent_speak" in streamed_text
    assert len(calls) == 2, "one bounded regeneration inside the same turn"
    assert "CORRECTION (regeneration)" in calls[1]
