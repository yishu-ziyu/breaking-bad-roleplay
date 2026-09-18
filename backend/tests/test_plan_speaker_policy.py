"""Plan speakers must reach Character Policy under canonical names (T14).

Incident (2026-09-18, found while finishing T12): the beat planner
occasionally names a speaker by short id ("jesse") instead of the canonical
backend name ("Jesse Pinkman"). ``CHARACTER_AGENTS`` is keyed by canonical
names, so the lookup missed, the Character Policy / validation block was
skipped, and the planner's *draft* line was published as-is — the same line
written as a full name went through policy. A plan defect could therefore
bypass the character pipeline and show the player raw draft dialogue.

Contract under test:
1. Given a plan whose speaker is a short id, when the beat runs, then the
   Character Policy sub-agent is called and the policy line is published
   (never the planner draft).
2. Given a plan speaker that still cannot be resolved to the playable cast
   after normalization, when the beat runs, then that line is dropped with a
   logged reason (``unresolved_speaker`` + code/retryable) and the beat
   regenerates once — the draft never appears in published events.
3. At the runtime publish gate (``story/renderer.py``), an ``agent_speak``
   whose id is not a canonical playable character is refused with a
   distinguishable reason; it is never committed/streamed as a draft.
"""

from __future__ import annotations

import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from agents.director import (
    DirectorAgent,
    canonical_playable_character_id,
)
from db.models import Session
from db.session import Base
from models.schemas import AgentEvent
from scenes.world_state import seed_world
from story.renderer import StoryTurnRejected, render_turn
from story.service import TurnClaim, claim_turn, initialize_story


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _plan_short_id_speak() -> str:
    """The planner names Jesse by short id (the reported bug shape)."""
    return json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "jesse",
                    "content": "DRAFT_MUST_NOT_PUBLISH",
                    "emotion_state": "tense",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            }
        ]
    )


def _plan_unresolved_speak() -> str:
    return json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "gomez",
                    "content": "GOMEZ_DRAFT_MUST_NOT_PUBLISH",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            }
        ]
    )


def _plan_unresolved_plus_valid() -> str:
    return json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "gomez",
                    "content": "GOMEZ_DRAFT_MUST_NOT_PUBLISH",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "jesse",
                    "content": "JESSE_DRAFT",
                    "emotion_state": "tense",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
        ]
    )


async def _character_reply(**_kwargs):
    return {
        "reply_text": "Policy-owned line.",
        "emotion_state": "tense",
        "gif_search_query": None,
        "thinking": None,
        "action": {"verb": "idle_tense"},
    }


async def _collect_beat(
    director, *, context=None, require_speak=True
) -> tuple[list[AgentEvent], AsyncMock]:
    if context is None:
        context = {
            "player_actor_id": "walter",
            "allowed_actor_ids": ["walter", "jesse"],
            "turn_rejection_log": [],
        }
    with patch(
        "agents.characters.base.BaseCharacter.respond_structured",
        side_effect=_character_reply,
    ) as policy_call:
        events = [
            event
            async for event in director._generate_beat(
                task="Cold open",
                outline="1. The desert",
                beat_index=0,
                context=context,
                language="en",
                require_character_speak=require_speak,
            )
        ]
    return events, policy_call


# ---------------------------------------------------------------------------
# 0. One source of truth for the character-id mapping
# ---------------------------------------------------------------------------


def test_canonical_playable_character_id_shares_the_direct_crew_mapping():
    assert canonical_playable_character_id("jesse") == "Jesse Pinkman"
    assert canonical_playable_character_id("Jesse Pinkman") == "Jesse Pinkman"
    assert canonical_playable_character_id("HANK") == "Hank Schrader"
    assert canonical_playable_character_id("walter white") == "Walter White"
    # Outside the playable cast (or empty) never resolves.
    assert canonical_playable_character_id("gomez") is None
    assert canonical_playable_character_id("") is None
    assert canonical_playable_character_id(None) is None


# ---------------------------------------------------------------------------
# 1. Short-id speaker runs Character Policy (not the draft path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_short_id_speaker_runs_character_policy(mock_provider):
    director = DirectorAgent(provider=mock_provider)
    mock_provider.call_model = AsyncMock(side_effect=[_plan_short_id_speak()])
    context = {
        "player_actor_id": "walter",
        "allowed_actor_ids": ["walter", "jesse"],
        "turn_rejection_log": [],
    }

    events, policy_call = await _collect_beat(director, context=context)

    assert policy_call.await_count == 1, (
        "a short-id speaker must still run the Character Policy sub-agent"
    )
    speaks = [event for event in events if event.type == "agent_speak"]
    assert len(speaks) == 1
    assert speaks[0].data["character_id"] == "Jesse Pinkman", (
        "published speaker must carry the canonical name"
    )
    assert speaks[0].data["content"] == "Policy-owned line."
    assert speaks[0].data.get("turn_validation_ok") is True
    draft_leaked = [
        event
        for event in events
        if "DRAFT_MUST_NOT_PUBLISH" in str(event.data.get("content") or "")
    ]
    assert draft_leaked == [], "the planner draft must never be published"
    assert context["turn_rejection_log"] == []


# ---------------------------------------------------------------------------
# 2. Unresolved speakers: dropped, logged with code, regenerated once
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unresolved_speaker_is_dropped_logged_and_regenerated(
    mock_provider, caplog
):
    director = DirectorAgent(provider=mock_provider)
    mock_provider.call_model = AsyncMock(
        side_effect=[_plan_unresolved_speak(), _plan_unresolved_speak()]
    )
    context = {
        "player_actor_id": "walter",
        "allowed_actor_ids": ["walter", "jesse"],
        "turn_rejection_log": [],
    }

    with caplog.at_level(logging.WARNING, logger="agents.director"):
        events, policy_call = await _collect_beat(director, context=context)

    assert not any(event.type == "agent_speak" for event in events)
    assert not any(
        "GOMEZ_DRAFT_MUST_NOT_PUBLISH" in str(event.data.get("content") or "")
        for event in events
    )
    assert policy_call.await_count == 0, "no policy call for a non-playable speaker"

    rejections = context["turn_rejection_log"]
    assert rejections, "the dropped speaker must be recorded"
    first = rejections[0]
    assert first["character_id"] == "gomez"
    assert first["reason"] == "unresolved_speaker"
    assert first["code"] == "unresolved_speaker"
    assert first["retryable"] is True
    assert "unresolved speaker" in caplog.text
    assert "gomez" in caplog.text

    # The drop leaves no speak, so the existing bounded in-beat regeneration
    # runs once (same command/billing) instead of publishing a draft.
    assert mock_provider.call_model.await_count == 2


@pytest.mark.asyncio
async def test_unresolved_speaker_dropped_while_valid_speaker_publishes(
    mock_provider, caplog
):
    director = DirectorAgent(provider=mock_provider)
    mock_provider.call_model = AsyncMock(side_effect=[_plan_unresolved_plus_valid()])
    context = {
        "player_actor_id": "walter",
        "allowed_actor_ids": ["walter", "jesse"],
        "turn_rejection_log": [],
    }

    with caplog.at_level(logging.WARNING, logger="agents.director"):
        events, policy_call = await _collect_beat(director, context=context)

    assert policy_call.await_count == 1
    speaks = [event for event in events if event.type == "agent_speak"]
    assert len(speaks) == 1
    assert speaks[0].data["character_id"] == "Jesse Pinkman"
    assert speaks[0].data["content"] == "Policy-owned line."
    assert not any(
        "GOMEZ_DRAFT_MUST_NOT_PUBLISH" in str(event.data.get("content") or "")
        for event in events
    )
    assert any(
        item["character_id"] == "gomez"
        and item["reason"] == "unresolved_speaker"
        for item in context["turn_rejection_log"]
    )
    assert "unresolved speaker" in caplog.text


# ---------------------------------------------------------------------------
# 3. Runtime publish gate: non-canonical / unresolved speakers are refused
# ---------------------------------------------------------------------------


def _claim(*, scenario: str = "desert_crisis") -> TurnClaim:
    return TurnClaim(
        session_id="s-1",
        command_id="opening",
        revision=0,
        world=seed_world("walter", scenario),
        payload={"action": "start", "command_id": "opening", "expected_revision": 0},
        task="Cold open",
        outline="1. The desert",
        beat_index=0,
        perspective=None,
    )


def _director_yielding(*events: AgentEvent):
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
async def test_renderer_refuses_unresolved_speaker_draft(caplog):
    director = _director_yielding(
        AgentEvent(
            type="agent_speak",
            data={"character_id": "gomez", "content": "GOMEZ_DRAFT_MUST_NOT_PUBLISH"},
        ),
    )

    with caplog.at_level(logging.WARNING, logger="story.renderer"):
        with pytest.raises(StoryTurnRejected) as excinfo:
            await _drain(render_turn(director, None, _claim()))

    assert excinfo.value.code == "no_accepted_character_turn"
    detail = json.loads(excinfo.value.detail)
    assert detail["reason"] == "all_character_speaks_rejected"
    assert {
        "type": "agent_speak",
        "character_id": "gomez",
        "reason": "unresolved_speaker",
    } in detail["rejected_events"]
    assert "unresolved_speaker" in caplog.text


@pytest.mark.asyncio
async def test_renderer_refuses_non_canonical_short_id_speaker(caplog):
    """A resolvable short id still must not publish: only the policy path may.

    The real beat generator canonicalizes before Character Policy, so this
    gate is defense in depth: a draft that skipped policy can never become a
    published event — it is refused with a distinguishable reason instead.
    """
    director = _director_yielding(
        AgentEvent(
            type="agent_speak",
            data={"character_id": "jesse", "content": "SHORT_ID_DRAFT"},
        ),
    )

    with caplog.at_level(logging.WARNING, logger="story.renderer"):
        with pytest.raises(StoryTurnRejected) as excinfo:
            await _drain(render_turn(director, None, _claim()))

    detail = json.loads(excinfo.value.detail)
    assert detail["reason"] == "all_character_speaks_rejected"
    assert {
        "type": "agent_speak",
        "character_id": "jesse",
        "reason": "speaker_not_canonical",
    } in detail["rejected_events"]
    assert "speaker_not_canonical" in caplog.text


@pytest.fixture
async def story_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        session = Session(
            id="s-1",
            title="test",
            task_prompt="Cold open",
            plot_outline="1. The desert",
            next_beat_index=0,
            active_character_id="walter",
            status="active",
        )
        db.add(session)
        initialize_story(db, session, scenario_id="desert_crisis")
        await db.commit()
    yield factory
    await engine.dispose()


@pytest.mark.asyncio
async def test_runtime_rejection_carries_unresolved_speaker_reason(
    mock_provider, story_factory, caplog
):
    """Real director + real publish gate: the dropped draft is refused with
    ``unresolved_speaker`` in the rejection detail (SSE error reasons)."""
    director = DirectorAgent(provider=mock_provider)
    planned = json.loads(_plan_unresolved_speak())
    director._plan_beat_events = AsyncMock(return_value=(planned, None, []))
    claim = await claim_turn(story_factory, "s-1")

    with caplog.at_level(logging.WARNING):
        with pytest.raises(StoryTurnRejected) as excinfo:
            await _drain(render_turn(director, story_factory, claim))

    exc = excinfo.value
    assert exc.code == "no_accepted_character_turn"
    detail = json.loads(exc.detail)
    assert detail["reason"] == "planner_emitted_no_character_speak"
    entries = [
        item for item in detail["turn_rejections"]
        if item.get("reason") == "unresolved_speaker"
    ]
    assert entries, detail
    assert entries[0]["character_id"] == "gomez"
    assert entries[0]["code"] == "unresolved_speaker"
    assert entries[0]["retryable"] is True
    assert "unresolved speaker" in caplog.text
    assert "no accepted character turn" in caplog.text


@pytest.mark.asyncio
async def test_renderer_still_publishes_canonical_speaker(story_factory):
    """The normal path is untouched: canonical speaker commits as before."""
    director = _director_yielding(
        AgentEvent(
            type="agent_speak",
            data={"character_id": "Jesse Pinkman", "content": "Kill the lights."},
        ),
    )
    claim = await claim_turn(story_factory, "s-1")
    events = [
        event async for event in render_turn(director, story_factory, claim)
    ]
    speaks = [event for event in events if event.type == "agent_speak"]
    assert len(speaks) == 1
    assert speaks[0].data["character_id"] == "Jesse Pinkman"
    assert speaks[0].data["content"] == "Kill the lights."
