"""Real SQL transactions and saved public events, no external DB or model."""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db.models import Session, Message
from db.session import Base
from models.schemas import AgentEvent
from story.service import (
    StoryConflict, initialize_story, enqueue_turn, claim_turn,
    commit_turn, release_turn, renew_claim,
)


@pytest.fixture
async def factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        session = Session(id="s1", title="test", task_prompt="Original premise",
                          plot_outline="1. Opening\n2. Consequence", next_beat_index=0,
                          active_character_id="walter", status="active")
        db.add(session)
        initialize_story(db, session, scenario_id="desert_crisis")
        await db.commit()
    yield factory
    await engine.dispose()


async def finish(factory, claim):
    events = [AgentEvent(type="agent_speak", data={"character_id": "Jesse Pinkman", "content": "Wait."})]
    return await commit_turn(factory, claim, world=claim.world, events=events,
                             outline="1. Opening\n2. Consequence", next_beat_index=1)


@pytest.mark.asyncio
async def test_committed_turn_replays_exact_events_without_claiming_again(factory):
    claim = await claim_turn(factory, "s1")
    published = await finish(factory, claim)
    replay = await claim_turn(factory, "s1")
    assert replay.saved_events == published
    assert replay.token is None
    async with factory() as db:
        session = await db.get(Session, "s1")
        assert session.world_revision == 1
        messages = (await db.execute(select(Message))).scalars().all()
        assert [m.content for m in messages] == ["Wait."]


@pytest.mark.asyncio
async def test_retry_action_is_idempotent_and_preserves_outline(factory):
    await finish(factory, await claim_turn(factory, "s1"))
    payload = {"action": "act", "player_input": "Give Jesse the phone", "command_id": "cmd1", "expected_revision": 1}
    async with factory() as db:
        session = await db.get(Session, "s1")
        first = await enqueue_turn(db, session, payload)
        await db.commit()
    async with factory() as db:
        session = await db.get(Session, "s1")
        second = await enqueue_turn(db, session, payload)
        assert first["command_id"] == second["command_id"]
        assert session.task_prompt == "Original premise"
        assert session.plot_outline == "1. Opening\n2. Consequence"
        assert session.next_beat_index == 1
        with pytest.raises(StoryConflict, match="idempotency_mismatch"):
            await enqueue_turn(db, session, {**payload, "player_input": "A different action"})


@pytest.mark.asyncio
async def test_stale_actions_cannot_overwrite_new_world(factory):
    await finish(factory, await claim_turn(factory, "s1"))
    async with factory() as db:
        session = await db.get(Session, "s1")
        with pytest.raises(StoryConflict, match="revision_conflict"):
            await enqueue_turn(db, session, {"action": "continue", "command_id": "old", "expected_revision": 0})


@pytest.mark.asyncio
async def test_interrupted_generation_releases_claim_without_advancing_world(factory):
    first = await claim_turn(factory, "s1")
    with pytest.raises(StoryConflict, match="turn_in_progress"):
        await claim_turn(factory, "s1")
    assert await release_turn(factory, first) is True
    assert await release_turn(factory, first) is True
    retry = await claim_turn(factory, "s1")
    assert retry.command_id == first.command_id
    assert retry.revision == 0
    assert retry.token != first.token
    with pytest.raises(StoryConflict, match="claim_lost"):
        await finish(factory, first)
    await finish(factory, retry)


@pytest.mark.asyncio
async def test_release_does_not_report_success_after_the_database_already_committed(factory):
    claim = await claim_turn(factory, "s1")
    await finish(factory, claim)

    # Model the narrow cancellation window after COMMIT but before an in-memory
    # acknowledgement reaches the response cleanup. The persisted row is the
    # authority: this request must not receive a quota refund for completed work.
    claim.committed = False
    assert await release_turn(factory, claim) is False


@pytest.mark.asyncio
async def test_failed_transaction_does_not_publish_or_persist_candidate(factory):
    claim = await claim_turn(factory, "s1")
    # Stop is a genuine concurrent cancellation, checked again under the commit lock.
    async with factory() as db:
        session = await db.get(Session, "s1")
        session.status = "paused"
        await db.commit()
    with pytest.raises(StoryConflict, match="story_paused"):
        await finish(factory, claim)
    async with factory() as db:
        session = await db.get(Session, "s1")
        assert session.world_revision == 0
        assert not (await db.execute(select(Message))).scalars().all()


@pytest.mark.asyncio
async def test_heartbeat_stops_renewing_after_player_pauses_story(factory):
    claim = await claim_turn(factory, "s1")
    async with factory() as db:
        session = await db.get(Session, "s1")
        session.status = "paused"
        await db.commit()

    with pytest.raises(StoryConflict, match="story_paused"):
        await renew_claim(factory, claim)

    async with factory() as db:
        session = await db.get(Session, "s1")
        assert session.world_revision == 0
        assert session.pending_command_id == "opening"


@pytest.mark.asyncio
async def test_public_events_strip_private_policy_and_retain_stable_ids(factory):
    claim = await claim_turn(factory, "s1")
    events = [AgentEvent(type="agent_speak", data={
        "character_id": "Jesse Pinkman", "content": "Wait.",
        "private_goal": "SECRET_MARKER", "subtext": "PRIVATE_SUBTEXT",
    })]
    result = await commit_turn(factory, claim, world=claim.world, events=events,
                               outline="1. Opening\n2. Consequence", next_beat_index=1)
    assert "SECRET_MARKER" not in json.dumps(result)
    assert "PRIVATE_SUBTEXT" not in json.dumps(result)
    assert all(event["data"].get("event_id") for event in result)
    assert result[-1]["type"] == "beat_ready"
    assert result[-1]["data"]["world_revision"] == 1
    assert result[-1]["data"]["player_actor_id"] == "walter"


@pytest.mark.asyncio
async def test_player_action_is_committed_but_director_outline_stays_private(factory):
    claim = await claim_turn(factory, "s1")
    events = [
        AgentEvent(type="player_turn", data={"kind": "do", "content": "Give Jesse the phone."}),
        AgentEvent(type="outline", data={"content": "1. Opening\n2. Consequence"}),
        AgentEvent(type="agent_speak", data={"character_id": "Jesse Pinkman", "content": "Fine."}),
    ]

    result = await commit_turn(
        factory,
        claim,
        world=claim.world,
        events=events,
        outline="1. Opening\n2. Consequence",
        next_beat_index=1,
    )

    assert result[0]["type"] == "player_turn"
    assert result[0]["data"]["content"] == "Give Jesse the phone."
    assert result[0]["data"]["event_id"] == "opening:0"
    assert not any(event["type"] == "outline" for event in result)
    replay = await claim_turn(factory, "s1", "opening")
    assert replay.saved_events == result


@pytest.mark.asyncio
async def test_narrative_failure_cannot_stream_a_partial_candidate(factory):
    from story.renderer import render_turn
    director = MagicMock()
    director._parse_outline.return_value = ["Opening", "Consequence"]
    director._short_scene_name.return_value = "desert"

    async def broken(**kwargs):
        yield AgentEvent(type="agent_speak", data={"character_id": "Jesse Pinkman", "content": "UNPUBLISHED"})
        raise RuntimeError("render failed")

    director._generate_beat = broken
    claim = await claim_turn(factory, "s1")
    published = []
    with pytest.raises(RuntimeError, match="render failed"):
        async for event in render_turn(director, factory, claim, language="en"):
            published.append(event)
    assert published == []
    async with factory() as db:
        assert not (await db.execute(select(Message))).scalars().all()
        assert (await db.get(Session, "s1")).world_revision == 0


@pytest.mark.asyncio
async def test_committed_runtime_replaces_untrusted_scene_narration_with_world_copy(factory):
    from story.renderer import render_turn

    director = MagicMock()
    director._parse_outline.return_value = ["Opening", "Consequence"]
    director._short_scene_name.return_value = "desert"

    async def perform(**kwargs):
        yield AgentEvent(type="scene_change", data={
            "from_scene": "rv",
            "to_scene": "desert",
            "description": "The RV door groans open into the cold desert.",
            "private_note": "must never leave the server",
        })
        yield AgentEvent(type="agent_speak", data={
            "character_id": "Jesse Pinkman",
            "content": "You hear that?",
        })

    director._generate_beat = perform
    claim = await claim_turn(factory, "s1")
    result = [event async for event in render_turn(director, factory, claim, language="en")]

    scene = next(event for event in result if event.type == "scene_change")
    assert scene.data["description"] != "The RV door groans open into the cold desert."
    assert "New Mexico" in scene.data["description"]
    assert "private_note" not in scene.data


@pytest.mark.asyncio
async def test_player_action_resolves_before_performance_and_does_not_replace_premise(factory):
    from story.renderer import render_turn
    await finish(factory, await claim_turn(factory, "s1"))
    async with factory() as db:
        session = await db.get(Session, "s1")
        await enqueue_turn(db, session, {"action": "act", "command_id": "give_phone", "expected_revision": 1,
                                        "player_input": "Give Jesse my phone"})
        await db.commit()
    director = MagicMock()
    director.provider.call_model = AsyncMock(return_value=json.dumps({"verb": "give", "item_id": "phone", "target_id": "jesse"}))
    director._parse_outline.return_value = ["Opening", "Consequence"]
    director._short_scene_name.return_value = "desert"
    seen = []

    async def perform(**kwargs):
        seen.append(kwargs)
        yield AgentEvent(type="agent_speak", data={"character_id": "Jesse Pinkman", "content": "All right."})

    director._generate_beat = perform
    claim = await claim_turn(factory, "s1")
    events = [event async for event in render_turn(director, factory, claim, language="en")]
    assert events[-1].type in {"beat_ready", "complete"}
    assert "Original premise" in seen[0]["task"]
    assert seen[0]["context"]["player_actor_id"] == "walter"
    async with factory() as db:
        session = await db.get(Session, "s1")
        assert session.task_prompt == "Original premise"
        assert json.loads(session.world_state)["items"]["phone"]["holder"] == "jesse"


@pytest.mark.asyncio
async def test_switch_perspective_changes_the_player_actor_and_persists_it(factory):
    from story.renderer import render_turn

    await finish(factory, await claim_turn(factory, "s1"))
    async with factory() as db:
        session = await db.get(Session, "s1")
        await enqueue_turn(db, session, {
            "action": "switch_perspective", "command_id": "switch_to_jesse",
            "expected_revision": 1, "target_character": "jesse",
        })
        await db.commit()

    director = MagicMock()
    director._parse_outline.return_value = ["Opening", "Consequence"]
    director._short_scene_name.return_value = "desert"

    async def perform(**kwargs):
        assert kwargs["context"]["player_actor_id"] == "jesse"
        yield AgentEvent(type="agent_speak", data={
            "character_id": "Walter White", "content": "Fine.",
        })

    director._generate_beat = perform
    claim = await claim_turn(factory, "s1")
    events = [event async for event in render_turn(director, factory, claim, language="en")]
    assert any(event.type == "agent_speak" for event in events)
    async with factory() as db:
        session = await db.get(Session, "s1")
        assert session.active_character_id == "jesse"
        assert json.loads(session.world_state)["player_id"] == "jesse"


@pytest.mark.asyncio
async def test_branch_uses_the_selected_snapshot_and_hides_abandoned_future(factory):
    from story.service import lineage
    await finish(factory, await claim_turn(factory, "s1"))
    async with factory() as db:
        session = await db.get(Session, "s1")
        await enqueue_turn(db, session, {"action": "continue", "command_id": "future", "expected_revision": 1})
        await db.commit()
    future = await claim_turn(factory, "s1")
    future.world.items["phone"].holder = "jesse"
    await finish(factory, future)
    async with factory() as db:
        session = await db.get(Session, "s1")
        await enqueue_turn(db, session, {"action": "branch", "command_id": "branch", "expected_revision": 2,
                                        "from_beat_id": "beat_1", "branch_goal": "Keep the phone"})
        await db.commit()
    branch = await claim_turn(factory, "s1")
    assert branch.world.items["phone"].holder == "walter"
    await finish(factory, branch)
    async with factory() as db:
        session = await db.get(Session, "s1")
        assert [turn.command_id for turn in await lineage(db, session)] == ["branch", "opening"]
        assert session.world_revision == 3


@pytest.mark.asyncio
async def test_pending_branch_recovery_uses_selected_parent_not_abandoned_future(factory):
    from story.service import recovery_lineage, recovery_world

    await finish(factory, await claim_turn(factory, "s1"))
    async with factory() as db:
        session = await db.get(Session, "s1")
        await enqueue_turn(db, session, {
            "action": "continue",
            "command_id": "future",
            "expected_revision": 1,
        })
        await db.commit()
    future_claim = await claim_turn(factory, "s1")
    future_claim.world.items["phone"].holder = "jesse"
    await finish(factory, future_claim)

    async with factory() as db:
        session = await db.get(Session, "s1")
        await enqueue_turn(db, session, {
            "action": "branch",
            "command_id": "pending_branch",
            "expected_revision": 2,
            "from_beat_id": "beat_1",
            "branch_goal": "Choose another consequence.",
        })
        await db.commit()

    async with factory() as db:
        session = await db.get(Session, "s1")
        assert [turn.command_id for turn in await recovery_lineage(db, session)] == ["opening"]
        recovered = await recovery_world(db, session)
        assert recovered.items["phone"].holder == "walter"
        assert json.loads(session.world_state)["items"]["phone"]["holder"] == "jesse"


@pytest.mark.asyncio
async def test_lineage_loads_a_branch_in_one_recursive_query(factory):
    from story.service import lineage

    await finish(factory, await claim_turn(factory, "s1"))
    async with factory() as db:
        session = await db.get(Session, "s1")
        await enqueue_turn(db, session, {
            "action": "continue",
            "command_id": "second",
            "expected_revision": 1,
        })
        await db.commit()
    await finish(factory, await claim_turn(factory, "s1"))

    engine = factory.kw["bind"].sync_engine
    statements: list[str] = []

    def record(_conn, _cursor, statement, _parameters, _context, _executemany):
        if "story_turns" in statement.lower():
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        async with factory() as db:
            session = await db.get(Session, "s1")
            statements.clear()
            turns = await lineage(db, session)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert [turn.command_id for turn in turns] == ["second", "opening"]
    assert len(statements) == 1


@pytest.mark.asyncio
async def test_real_director_character_pipeline_preserves_player_control(factory):
    from agents.director import DirectorAgent
    from agents.provider import ModelResult
    from story.renderer import render_turn

    provider = MagicMock()
    provider.resolve_model_route.return_value = "stepfun/test"
    provider.call_model = AsyncMock(return_value=json.dumps([
        {"type": "agent_speak", "data": {"character_id": "Walter White", "content": "PLAYER_DRAFT"}},
        {"type": "agent_speak", "data": {"character_id": "Jesse Pinkman", "content": "draft"}},
    ]))
    provider.call_model_with_tools = AsyncMock(return_value=ModelResult(
        content=json.dumps({"reply_text": "Tell me what you need.", "emotion_state": "tense",
                            "thinking": None, "action": {"verb": "idle_tense"}}),
        tool_calls=[], stop_reason="end_turn",
    ))
    director = DirectorAgent(provider)
    claim = await claim_turn(factory, "s1")
    events = [event async for event in render_turn(director, factory, claim, language="en")]
    lines = [event.data for event in events if event.type == "agent_speak"]
    assert len(lines) == 1
    assert lines[0]["character_id"] == "Jesse Pinkman"
    assert lines[0]["content"] == "Tell me what you need."
    assert "PLAYER_DRAFT" not in str(events)
    system = provider.call_model_with_tools.await_args.args[0][0]["content"]
    assert "holder=walter" in system
    assert "human alone controls walter" in system
