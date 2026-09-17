"""Stopping runtime-v1 Story commands preserves committed history."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api import routes
from db.models import Message, Session, StoryTurn
from db.session import Base, get_db
from main import app
from models.schemas import AgentEvent
from story.service import (
    StoryConflict,
    claim_turn,
    commit_turn,
    enqueue_turn,
    initialize_story,
    lineage,
    recovery_lineage,
    recovery_world,
    release_turn,
    stop_turn,
)


@pytest.fixture
async def factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        session = Session(
            id="s1",
            title="test",
            task_prompt="Original premise",
            plot_outline="1. Opening\n2. Consequence",
            next_beat_index=0,
            active_character_id="walter",
            status="active",
        )
        db.add(session)
        initialize_story(db, session, scenario_id="desert_crisis")
        await db.commit()
    yield factory
    await engine.dispose()


async def finish(factory, claim, content="Wait."):
    return await commit_turn(
        factory,
        claim,
        world=claim.world,
        events=[
            AgentEvent(
                type="agent_speak",
                data={"character_id": "Jesse Pinkman", "content": content},
            )
        ],
        outline="1. Opening\n2. Consequence",
        next_beat_index=claim.revision + 1,
    )


async def enqueue_second(factory, command_id="second"):
    payload = {
        "action": "act",
        "player_input": "Give Jesse the phone",
        "command_id": command_id,
        "expected_revision": 1,
    }
    async with factory() as db:
        session = await db.get(Session, "s1")
        await enqueue_turn(db, session, payload)
        await db.commit()
    return payload


@pytest.mark.asyncio
async def test_stop_abandons_pending_command_and_keeps_committed_history(factory):
    committed = await finish(factory, await claim_turn(factory, "s1"))
    await enqueue_second(factory)
    await claim_turn(factory, "s1", "second")

    async with factory() as db:
        session = await db.get(Session, "s1")
        snapshot = session.world_state
        result = await stop_turn(db, session)
        await db.commit()

    assert result == {
        "command_id": "opening",
        "cancelled_command_id": "second",
        "world_revision": 1,
    }
    async with factory() as db:
        session = await db.get(Session, "s1")
        assert session.pending_command_id is None
        assert session.generation_token is None
        assert session.generation_started_at is None
        assert session.status == "stopped"
        assert session.world_revision == 1
        assert session.world_state == snapshot
        assert [message.content for message in (
            await db.execute(select(Message).order_by(Message.created_at))
        ).scalars()] == ["Wait."]
        turns = await lineage(db, session)
        assert [turn.command_id for turn in turns] == ["opening"]
        assert json.loads(turns[0].events) == committed


@pytest.mark.asyncio
async def test_late_commit_after_stop_is_rejected_and_change_never_lands(factory):
    await finish(factory, await claim_turn(factory, "s1"))
    await enqueue_second(factory)
    claim = await claim_turn(factory, "s1", "second")
    claim.world.items["phone"].holder = "jesse"

    async with factory() as db:
        session = await db.get(Session, "s1")
        await stop_turn(db, session)
        await db.commit()

    assert await release_turn(factory, claim) is True
    with pytest.raises(StoryConflict, match="claim_lost"):
        await finish(factory, claim, content="This must not land.")

    async with factory() as db:
        session = await db.get(Session, "s1")
        candidate = await db.get(StoryTurn, ("s1", "second"))
        messages = (await db.execute(select(Message))).scalars().all()
        assert candidate.events is None
        assert candidate.snapshot_after is None
        assert session.world_revision == 1
        assert json.loads(session.world_state)["items"]["phone"]["holder"] == "walter"
        assert [message.content for message in messages] == ["Wait."]


@pytest.mark.asyncio
async def test_commit_that_finishes_before_stop_is_kept(factory):
    committed = await finish(factory, await claim_turn(factory, "s1"))

    async with factory() as db:
        session = await db.get(Session, "s1")
        snapshot = session.world_state
        result = await stop_turn(db, session)
        await db.commit()

    assert result["cancelled_command_id"] is None
    assert result["command_id"] == "opening"
    async with factory() as db:
        session = await db.get(Session, "s1")
        opening = await db.get(StoryTurn, ("s1", "opening"))
        messages = (await db.execute(select(Message))).scalars().all()
        assert session.status == "stopped"
        assert session.pending_command_id is None
        assert session.world_revision == 1
        assert session.world_state == snapshot
        assert json.loads(opening.events) == committed
        assert [message.content for message in messages] == ["Wait."]


@pytest.mark.asyncio
async def test_stopped_session_cannot_be_reclaimed_or_replayed(factory):
    await finish(factory, await claim_turn(factory, "s1"))
    payload = await enqueue_second(factory, command_id="cancelled")
    await claim_turn(factory, "s1", "cancelled")
    async with factory() as db:
        session = await db.get(Session, "s1")
        await stop_turn(db, session)
        await db.commit()

    with pytest.raises(StoryConflict, match="story_paused"):
        await claim_turn(factory, "s1", "cancelled")
    async with factory() as db:
        session = await db.get(Session, "s1")
        with pytest.raises(StoryConflict) as conflict:
            await enqueue_turn(db, session, payload)
        assert conflict.value.code == "story_stopped"

    async with factory() as db:
        session = await db.get(Session, "s1")
        assert session.pending_command_id is None
        assert session.status == "stopped"


@pytest.mark.asyncio
async def test_stop_blocks_every_mutating_action(factory):
    await finish(factory, await claim_turn(factory, "s1"))
    async with factory() as db:
        session = await db.get(Session, "s1")
        await stop_turn(db, session)
        await db.commit()

    actions = {
        "act": {"player_input": "Give Jesse the phone"},
        "continue": {},
        "redirect": {"redirect_prompt": "Take the story to the car wash"},
        "branch": {
            "from_beat_id": "beat_1",
            "branch_goal": "Keep the phone",
        },
        "continue_chapter": {},
        "switch_perspective": {"target_character": "jesse"},
    }
    async with factory() as db:
        session = await db.get(Session, "s1")
        original_turns = set((await db.execute(
            select(StoryTurn.command_id).where(StoryTurn.session_id == "s1")
        )).scalars())
        for action, extra in actions.items():
            payload = {
                "action": action,
                "command_id": f"blocked_{action}",
                "expected_revision": 1,
                **extra,
            }
            with pytest.raises(StoryConflict) as conflict:
                await enqueue_turn(db, session, payload)
            assert conflict.value.code == "story_stopped"
            assert conflict.value.revision == 1
            assert session.status == "stopped"
            assert session.pending_command_id is None
            assert session.world_revision == 1

        remaining_turns = set((await db.execute(
            select(StoryTurn.command_id).where(StoryTurn.session_id == "s1")
        )).scalars())
        assert remaining_turns == original_turns


@pytest.mark.asyncio
async def test_stopped_session_still_serves_committed_history(factory):
    committed = await finish(factory, await claim_turn(factory, "s1"))
    async with factory() as db:
        session = await db.get(Session, "s1")
        snapshot = session.world_state
        await stop_turn(db, session)
        await db.commit()

    async with factory() as db:
        session = await db.get(Session, "s1")
        turns = await recovery_lineage(db, session)
        world = await recovery_world(db, session)
        request = SimpleNamespace(headers={})
        state = await routes.story_state_view(request, "s1", db)
        messages = await routes.list_session_messages(
            request, "s1", limit=500, offset=0, db=db
        )

        assert [turn.command_id for turn in turns] == ["opening"]
        assert json.loads(turns[0].events) == committed
        assert world.model_dump() == json.loads(snapshot)
        assert state["events"] == committed
        assert state["world_revision"] == 1
        assert state["pending_command_id"] is None
        assert state["status"] == "stopped"
        assert [message.content for message in messages] == ["Wait."]


@pytest.mark.asyncio
async def test_release_after_stop_signals_exactly_one_refund(factory):
    claim = await claim_turn(factory, "s1")
    async with factory() as db:
        session = await db.get(Session, "s1")
        await stop_turn(db, session)
        await db.commit()

    assert await release_turn(factory, claim) is True
    assert claim.released is True
    assert await release_turn(factory, claim) is True

    async with factory() as db:
        session = Session(
            id="s2",
            title="committed",
            task_prompt="Original premise",
            active_character_id="walter",
            status="active",
        )
        db.add(session)
        initialize_story(db, session, scenario_id="desert_crisis")
        await db.commit()
    committed_claim = await claim_turn(factory, "s2")
    await finish(factory, committed_claim)
    committed_claim.committed = False
    assert await release_turn(factory, committed_claim) is False
    assert committed_claim.committed is True


@pytest.fixture
async def story_api(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def database():
        async with factory() as db:
            yield db

    director = MagicMock()
    director._generate_outline = AsyncMock(
        return_value="1. Opening\n2. Consequence\n3. Choice"
    )
    director._parse_outline.side_effect = lambda text: text.splitlines()
    director._short_scene_name.return_value = "desert"
    director.provider.call_model = AsyncMock(
        return_value=json.dumps(
            {"verb": "give", "item_id": "phone", "target_id": "jesse"}
        )
    )

    async def perform(**kwargs):
        yield AgentEvent(
            type="agent_speak",
            data={"character_id": "Jesse Pinkman", "content": "All right."},
        )

    director._generate_beat = perform
    charge = AsyncMock(
        return_value=SimpleNamespace(byok=False, remaining=95, cost=5)
    )
    monkeypatch.setattr(routes, "async_session_factory", factory)
    monkeypatch.setattr(routes, "_require_platform_quota", charge)
    overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[routes.get_director] = lambda: director
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, charge, director
    app.dependency_overrides.clear()
    app.dependency_overrides.update(overrides)
    await engine.dispose()


async def create_story(client):
    response = await client.post(
        "/api/session/create",
        json={
            "title": "Test",
            "task_prompt": "Original premise",
            "active_character_id": "walter",
            "scenario_id": "desert_crisis",
            "language": "en",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    return data, f"/api/session/{data['session_id']}", {
        "X-Session-Key": data["session_key"]
    }


@pytest.mark.asyncio
async def test_stop_endpoint_keeps_history_and_blocks_the_cancelled_command(story_api):
    client, _charge, _director = story_api
    created, path, headers = await create_story(client)
    first = await client.get(path + "/stream", headers=headers)
    assert first.status_code == 200
    before = (await client.get(path + "/state", headers=headers)).json()
    action = await client.post(
        path + "/action",
        headers=headers,
        json={
            "action": "act",
            "player_input": "Give Jesse the phone",
            "command_id": "cancelled",
            "expected_revision": 1,
        },
    )
    assert action.status_code == 200, action.text

    stopped = await client.post(
        path + "/action", headers=headers, json={"action": "stop"}
    )

    assert stopped.status_code == 200, stopped.text
    assert stopped.json() == {
        "status": "ok",
        "session_id": created["session_id"],
        "command_id": "opening",
        "world_revision": 1,
        "runtime_version": 1,
    }
    state = (await client.get(path + "/state", headers=headers)).json()
    assert state["status"] == "stopped"
    assert state["pending_command_id"] is None
    assert state["command_id"] == "opening"
    assert state["world_revision"] == before["world_revision"]
    assert state["events"] == before["events"]

    replay = await client.post(
        path + "/action",
        headers=headers,
        json={
            "action": "act",
            "player_input": "Give Jesse the phone",
            "command_id": "cancelled",
            "expected_revision": 1,
        },
    )
    assert replay.status_code == 409, replay.text
    assert replay.json()["detail"]["code"] == "story_stopped"
    replayed_state = (await client.get(path + "/state", headers=headers)).json()
    assert replayed_state["pending_command_id"] is None
    assert replayed_state["status"] == "stopped"

    cancelled = await client.get(
        path + "/stream?command_id=cancelled", headers=headers
    )
    assert cancelled.status_code == 409
    assert cancelled.json()["detail"]["code"] == "story_paused"
    unscoped = await client.get(path + "/stream", headers=headers)
    assert unscoped.status_code == 409
    assert unscoped.json()["detail"]["code"] == "story_paused"


@pytest.mark.asyncio
async def test_stop_during_generation_refunds_the_beat_exactly_once(
    story_api, monkeypatch
):
    client, charge, director = story_api
    _created, path, headers = await create_story(client)
    opening = await client.get(path + "/stream", headers=headers)
    assert opening.status_code == 200
    action = await client.post(
        path + "/action",
        headers=headers,
        json={
            "action": "act",
            "player_input": "Give Jesse the phone",
            "command_id": "cancelled",
            "expected_revision": 1,
        },
    )
    assert action.status_code == 200, action.text

    generating = asyncio.Event()
    finish_generation = asyncio.Event()

    async def blocked_perform(**kwargs):
        generating.set()
        await finish_generation.wait()
        yield AgentEvent(
            type="agent_speak",
            data={"character_id": "Jesse Pinkman", "content": "Too late."},
        )

    director._generate_beat = blocked_perform
    refund = MagicMock()
    monkeypatch.setattr(routes, "_schedule_quota_refund", refund)
    stream_task = asyncio.create_task(
        client.get(path + "/stream?command_id=cancelled", headers=headers)
    )
    await asyncio.wait_for(generating.wait(), timeout=2)
    stopped = await client.post(
        path + "/action", headers=headers, json={"action": "stop"}
    )
    assert stopped.status_code == 200, stopped.text
    finish_generation.set()
    streamed = await asyncio.wait_for(stream_task, timeout=2)

    assert streamed.status_code == 200
    assert refund.call_count == 1
    charged = charge.await_count
    later = await client.get(path + "/stream", headers=headers)
    assert later.status_code == 409
    assert later.json()["detail"]["code"] == "story_paused"
    assert charge.await_count == charged
    assert refund.call_count == 1


@pytest.mark.asyncio
async def test_action_after_stop_cannot_reopen_the_run(factory):
    """Stop finished first: a late action must not create a new pending command."""
    await finish(factory, await claim_turn(factory, "s1"))
    await enqueue_second(factory, command_id="cancelled")
    await claim_turn(factory, "s1", "cancelled")
    async with factory() as db:
        session = await db.get(Session, "s1")
        await stop_turn(db, session)
        await db.commit()

    async with factory() as db:
        session = await db.get(Session, "s1")
        with pytest.raises(StoryConflict, match="story_stopped"):
            await enqueue_turn(db, session, {
                "action": "act", "player_input": "One more thing",
                "command_id": "late", "expected_revision": 1,
            })
        await db.rollback()
    async with factory() as db:
        session = await db.get(Session, "s1")
        assert session.world_revision == 1
        assert session.pending_command_id is None
        assert session.status == "stopped"
        assert await db.get(StoryTurn, ("s1", "late")) is None
        turns = await lineage(db, session)
        assert [turn.command_id for turn in turns] == ["opening"]


@pytest.mark.asyncio
async def test_stop_blocks_a_fresh_command_id_endpoint(story_api):
    client, _charge, _director = story_api
    _created, path, headers = await create_story(client)
    first = await client.get(path + "/stream", headers=headers)
    assert first.status_code == 200, first.text
    before = (await client.get(path + "/state", headers=headers)).json()
    before_graph_response = await client.get(path + "/plot-graph", headers=headers)
    assert before_graph_response.status_code == 200, before_graph_response.text
    before_graph = before_graph_response.json()
    beat_id = next(
        event["data"]["beat_id"]
        for event in before["events"]
        if event["type"] == "beat_ready"
    )

    stopped = await client.post(
        path + "/action", headers=headers, json={"action": "stop"}
    )
    assert stopped.status_code == 200, stopped.text
    late = await client.post(
        path + "/action",
        headers=headers,
        json={
            "action": "act",
            "player_input": "One more thing",
            "command_id": "fresh-after-stop",
            "expected_revision": before["world_revision"],
        },
    )

    assert late.status_code == 409, late.text
    assert late.json()["detail"]["code"] == "story_stopped"
    state = (await client.get(path + "/state", headers=headers)).json()
    assert state["status"] == "stopped"
    assert state["pending_command_id"] is None
    assert state["world_revision"] == before["world_revision"]
    assert state["events"] == before["events"]
    graph = (await client.get(path + "/plot-graph", headers=headers)).json()
    assert graph == before_graph

    replay = await client.post(
        path + "/action",
        headers=headers,
        json={"action": "replay", "beat_id": beat_id},
    )
    assert replay.status_code == 200, replay.text
    replayed_state = (await client.get(path + "/state", headers=headers)).json()
    assert replayed_state["status"] == "stopped"
    assert replayed_state["pending_command_id"] is None
    assert replayed_state["world_revision"] == before["world_revision"]
    assert replayed_state["events"] == before["events"]
