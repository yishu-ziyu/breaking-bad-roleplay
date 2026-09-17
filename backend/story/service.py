"""Story transaction boundary. No LLM calls and no plaintext logging here.

A command is claimed with a fencing token, generated outside transactions,
then committed together with its world snapshot and public event outbox.
SSE delivery/replay does not decide truth.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, literal, select, update
from sqlalchemy.orm import aliased

from db.models import Message, Session, StoryTurn
from models.schemas import AgentEvent
from scenes.world_state import WorldState, seed_world


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class StoryConflict(ValueError):
    def __init__(self, code: str, revision: int | None = None):
        super().__init__(code)
        self.code = code
        self.revision = revision


@dataclass
class TurnClaim:
    session_id: str
    command_id: str
    revision: int
    world: WorldState
    payload: dict[str, Any]
    task: str
    outline: str | None
    beat_index: int
    perspective: str | None
    token: str | None = None
    saved_events: list[dict[str, Any]] | None = None
    committed: bool = False
    released: bool = False


def initialize_story(db, session: Session, *, scenario_id: str = "conversation") -> None:
    """Called in the same transaction as session creation; never touches old rows."""
    player = (session.active_character_id or "walter").lower().split()[0]
    state = seed_world(player, scenario_id)
    session.world_state = state.model_dump_json()
    session.world_revision = 0
    session.pending_command_id = "opening"
    payload = {"action": "start", "command_id": "opening", "expected_revision": 0}
    db.add(StoryTurn(
        session_id=session.id, command_id="opening", request_hash=_hash(payload),
        payload=encode(payload), expected_revision=0, snapshot_before=session.world_state,
    ))


def _hash(payload: dict) -> str:
    return hashlib.sha256(encode(payload).encode()).hexdigest()


async def _locked_session(db, session_id: str) -> Session:
    result = await db.execute(
        select(Session).where(Session.id == session_id).with_for_update()
        .execution_options(populate_existing=True)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise StoryConflict("session_not_found")
    return row


async def enqueue_turn(db, session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """Caller verifies ownership; this function locks and caller commits."""
    session = await _locked_session(db, session.id)
    if session.status == "stopped":
        # Stop is terminal for this run: a late action from a stale tab must
        # not resurrect it, re-open a pending command or re-bill generation.
        raise StoryConflict("story_stopped", session.world_revision)
    command_id = str(payload.get("command_id") or uuid.uuid4())
    expected = payload.get("expected_revision")
    if expected is None:
        expected = session.world_revision  # compatibility for old control clients
    normalized = {k: v for k, v in payload.items() if v is not None}
    normalized.update(command_id=command_id, expected_revision=expected)
    existing = await db.get(StoryTurn, (session.id, command_id))
    if existing is not None:
        if existing.request_hash != _hash(normalized):
            raise StoryConflict("idempotency_mismatch", session.world_revision)
        return {"command_id": command_id, "world_revision": session.world_revision, "replayed": True}
    if expected != session.world_revision:
        raise StoryConflict("revision_conflict", session.world_revision)
    if session.pending_command_id:
        if normalized["action"] == "continue":
            session.status = "active"
            return {"command_id": session.pending_command_id,
                    "world_revision": session.world_revision, "replayed": True}
        raise StoryConflict("turn_in_progress", session.world_revision)
    if not session.world_state:
        raise StoryConflict("legacy_session", session.world_revision)
    if session.status == "complete" and normalized["action"] not in {
        "continue_chapter", "branch", "redirect",
    }:
        raise StoryConflict("chapter_complete", session.world_revision)

    parent = session.last_command_id
    snapshot = session.world_state
    if normalized["action"] == "branch":
        target = await find_beat(db, session, str(normalized.get("from_beat_id") or ""))
        if target is None or not target.snapshot_after:
            raise StoryConflict("beat_not_found", session.world_revision)
        parent, snapshot = target.command_id, target.snapshot_after
    db.add(StoryTurn(
        session_id=session.id, command_id=command_id, request_hash=_hash(normalized),
        payload=encode(normalized), expected_revision=expected,
        parent_command_id=parent, snapshot_before=snapshot,
    ))
    session.pending_command_id = command_id
    session.status = "active"
    return {"command_id": command_id, "world_revision": session.world_revision, "replayed": False}


async def stop_turn(db, session: Session) -> dict[str, Any]:
    """Atomically abandon the session's pending, uncommitted command.

    Keeps world snapshot, world_revision, messages and committed lineage.
    """
    session = await _locked_session(db, session.id)
    cancelled_command_id = session.pending_command_id
    session.generation_token = None
    session.generation_started_at = None
    session.pending_command_id = None
    session.status = "stopped"
    return {
        "command_id": session.last_command_id,
        "cancelled_command_id": cancelled_command_id,
        "world_revision": session.world_revision,
    }


async def claim_turn(factory, session_id: str, command_id: str | None = None) -> TurnClaim:
    async with factory() as db:
        session = await _locked_session(db, session_id)
        if session.status in ("paused", "stopped"):
            raise StoryConflict("story_paused", session.world_revision)
        cid = command_id or session.pending_command_id or session.last_command_id
        turn = await db.get(StoryTurn, (session_id, cid)) if cid else None
        if turn is None:
            raise StoryConflict("turn_not_found", session.world_revision)
        claim = TurnClaim(
            session_id=session_id, command_id=turn.command_id,
            revision=turn.expected_revision,
            world=WorldState.model_validate_json(turn.snapshot_before),
            payload=json.loads(turn.payload), task=session.task_prompt or "",
            outline=session.plot_outline, beat_index=session.next_beat_index,
            perspective=session.active_character_id,
        )
        if turn.events is not None:
            claim.saved_events = json.loads(turn.events)
            claim.committed = True
            return claim
        if session.pending_command_id != cid:
            raise StoryConflict("not_pending", session.world_revision)
        if (session.generation_token and session.generation_started_at
                and session.generation_started_at > now() - timedelta(minutes=5)):
            raise StoryConflict("turn_in_progress", session.world_revision)
        token = str(uuid.uuid4())
        # CAS also fences SQLite tests and processes not sharing Python locks.
        changed = await db.execute(update(Session).where(
            Session.id == session_id,
            Session.generation_token == session.generation_token,
            Session.world_revision == session.world_revision,
        ).values(generation_token=token, generation_started_at=now()))
        if changed.rowcount != 1:
            raise StoryConflict("turn_in_progress", session.world_revision)
        await db.commit()
        claim.token = token
        return claim


async def renew_claim(factory, claim: TurnClaim) -> None:
    if not claim.token or claim.committed:
        return
    async with factory() as db:
        changed = await db.execute(update(Session).where(
            Session.id == claim.session_id,
            Session.generation_token == claim.token,
            Session.status.not_in(("paused", "stopped")),
        ).values(generation_started_at=now()))
        await db.commit()
        if changed.rowcount == 1:
            return
        result = await db.execute(
            select(Session.status, Session.generation_token)
            .where(Session.id == claim.session_id)
        )
        row = result.one_or_none()
        if row is not None and row.status in ("paused", "stopped"):
            raise StoryConflict("story_paused", claim.revision)
        raise StoryConflict("claim_lost", claim.revision)


async def release_turn(factory, claim: TurnClaim) -> bool:
    """Release an unfinished generation claim.

    The boolean is deliberately sticky on ``claim``. ``render_turn`` and the
    HTTP response cleanup may both call this function; quota should be refunded
    when either layer actually released the same unfinished claim, but not when
    the database commit succeeded and only the local ``committed`` flag was
    lost to cancellation.
    """
    if claim.released:
        return True
    if not claim.token or claim.committed:
        return False
    async with factory() as db:
        session = await _locked_session(db, claim.session_id)
        turn = await db.get(StoryTurn, (claim.session_id, claim.command_id))
        if turn is not None and turn.events is not None:
            claim.committed = True
            return False
        if (session.generation_token == claim.token
                and session.pending_command_id == claim.command_id):
            session.generation_token = None
            session.generation_started_at = None
            await db.commit()
            claim.released = True
            return True
        if session.generation_token in (None, claim.token):
            claim.released = True
            return True
        return False


PUBLIC_FIELDS = {
    "player_turn": {"kind", "content"},
    "scene_change": {"from_scene", "to_scene", "description"},
    "agent_act": {"character_id", "action", "target", "source"},
    "agent_speak": {"character_id", "content", "emotion_state", "gif_search_query"},
    "status": {"message", "action_rejected", "reason"},
}


async def commit_turn(
    factory, claim: TurnClaim, *, world: WorldState, events: list[AgentEvent],
    outline: str, next_beat_index: int, effects: list[dict] | None = None,
    is_final: bool = False,
) -> list[dict[str, Any]]:
    revision = claim.revision + 1
    beat_id = f"beat_{revision}"
    public: list[dict[str, Any]] = []
    for event in events:
        if event.type not in PUBLIC_FIELDS:
            continue
        data = {k: v for k, v in event.data.items() if k in PUBLIC_FIELDS[event.type]}
        data.update(beat_id=beat_id, command_id=claim.command_id)
        public.append({"type": event.type, "data": data})
    public.append({"type": "beat_ready", "data": {
        "beat_id": beat_id, "beat_summary": "", "is_final": is_final,
        "world_revision": revision, "command_id": claim.command_id,
        "player_actor_id": world.player_id,
    }})
    if is_final:
        public.append({"type": "complete", "data": {
            "world_revision": revision,
            "player_actor_id": world.player_id,
        }})
    for index, event in enumerate(public):
        event["data"]["event_id"] = f"{claim.command_id}:{index}"
    # First delivery and persisted replay use the identical serialization order.
    public = json.loads(encode(public))

    async with factory() as db:
        session = await _locked_session(db, claim.session_id)
        if (session.generation_token != claim.token or not claim.token
                or session.pending_command_id != claim.command_id
                or session.world_revision != claim.revision):
            raise StoryConflict("claim_lost", session.world_revision)
        if session.status in ("paused", "stopped"):
            raise StoryConflict("story_paused", session.world_revision)
        turn = await db.get(StoryTurn, (claim.session_id, claim.command_id))
        if turn is None:
            raise StoryConflict("turn_not_found")
        turn.events = encode(public)
        turn.effects = encode(effects or [])
        turn.snapshot_after = world.model_dump_json()
        turn.accepted_revision = revision
        session.world_state = turn.snapshot_after
        session.world_revision = revision
        session.active_character_id = world.player_id
        session.plot_outline = outline
        session.next_beat_index = next_beat_index
        session.last_command_id = claim.command_id
        session.pending_command_id = None
        session.generation_token = None
        session.generation_started_at = None
        session.status = "complete" if is_final else "waiting"
        for event in public:
            if event["type"] != "agent_speak":
                continue
            data = event["data"]
            db.add(Message(
                session_id=claim.session_id, role="assistant", content=str(data.get("content") or ""),
                character_name=data.get("character_id"), emotion_state=data.get("emotion_state"),
                gif_search_query=data.get("gif_search_query"), beat_id=beat_id,
            ))
        await db.commit()
    claim.committed = True
    claim.saved_events = public
    return public


async def lineage(
    db,
    session: Session,
    limit: int = 200,
    *,
    head_command_id: str | None = None,
) -> list[StoryTurn]:
    """Follow one selected branch in a single recursive query."""
    cid = session.last_command_id if head_command_id is None else head_command_id
    if not cid or limit <= 0:
        return []

    chain = select(
        StoryTurn.command_id.label("command_id"),
        StoryTurn.parent_command_id.label("parent_command_id"),
        literal(0).label("depth"),
    ).where(
        StoryTurn.session_id == session.id,
        StoryTurn.command_id == cid,
    ).cte("story_lineage", recursive=True)
    parent = aliased(StoryTurn)
    chain = chain.union_all(
        select(
            parent.command_id,
            parent.parent_command_id,
            chain.c.depth + 1,
        ).where(
            parent.session_id == session.id,
            parent.command_id == chain.c.parent_command_id,
            chain.c.depth + 1 < limit,
        )
    )
    rows = await db.execute(
        select(StoryTurn)
        .join(
            chain,
            and_(
                StoryTurn.session_id == session.id,
                StoryTurn.command_id == chain.c.command_id,
            ),
        )
        .order_by(chain.c.depth)
    )
    return list(rows.scalars().all())


async def recovery_lineage(db, session: Session, limit: int = 200) -> list[StoryTurn]:
    """Return the branch the player should see while a command is pending.

    A pending branch already selected an earlier parent snapshot. Refresh must
    hide the abandoned future before the replacement beat commits; otherwise
    the manuscript briefly shows events that no longer belong to the branch.
    """
    head = session.last_command_id
    if session.pending_command_id:
        pending = await db.get(StoryTurn, (session.id, session.pending_command_id))
        if pending is not None:
            try:
                payload = json.loads(pending.payload)
            except (TypeError, ValueError):
                payload = {}
            if payload.get("action") == "branch":
                head = pending.parent_command_id
    return await lineage(db, session, limit=limit, head_command_id=head)


async def recovery_world(db, session: Session) -> WorldState:
    """Return the world snapshot that matches the branch shown on refresh.

    Most pending commands start from ``sessions.world_state``. A pending branch
    is different: its ledger row already selected an earlier snapshot, while
    the session row still contains the abandoned future until commit. Recovery
    must not combine the parent branch's manuscript with that future world.
    """
    snapshot = session.world_state
    if session.pending_command_id:
        pending = await db.get(StoryTurn, (session.id, session.pending_command_id))
        if pending is not None and pending.snapshot_before:
            snapshot = pending.snapshot_before
    if not snapshot:
        raise StoryConflict("legacy_session", session.world_revision)
    return WorldState.model_validate_json(snapshot)


async def find_beat(db, session: Session, beat_id: str) -> StoryTurn | None:
    for turn in await lineage(db, session):
        if f"beat_{turn.accepted_revision}" == beat_id:
            return turn
    return None
