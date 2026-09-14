"""Game stores. Memory for isolated tests; SQL for the live API."""

from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from typing import Any, Iterator, Protocol

from sqlalchemy import create_engine, event, func, make_url, select
from sqlalchemy.orm import Session, sessionmaker


class GameStore(Protocol):
    def unit_of_work(self) -> Iterator[None]: ...

    def put_run(self, row: dict[str, Any]) -> None: ...

    def get_run(self, run_id: str) -> dict[str, Any] | None: ...

    def lock_run(self, run_id: str) -> dict[str, Any] | None: ...

    def put_action(self, row: dict[str, Any]) -> None: ...

    def get_action(self, run_id: str, action_id: str) -> dict[str, Any] | None: ...

    def action_count(self, run_id: str) -> int: ...

    def append_event(self, row: dict[str, Any]) -> dict[str, Any]: ...

    def list_events(self, run_id: str, after: int = 0) -> list[dict[str, Any]]: ...

    def put_checkpoint(self, row: dict[str, Any]) -> None: ...

    def get_checkpoint(self, run_id: str, revision: int) -> dict[str, Any] | None: ...

    def put_job(self, row: dict[str, Any]) -> None: ...

    def update_job(self, job_id: str, **fields: Any) -> None: ...

    def get_job(self, job_id: str) -> dict[str, Any] | None: ...

    def jobs_for_revision(self, run_id: str, revision: int) -> list[dict[str, Any]]: ...


class MemoryGameStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._txn = threading.Lock()
        self.runs: dict[str, dict[str, Any]] = {}
        self.actions: dict[tuple[str, str], dict[str, Any]] = {}
        self.events: dict[str, list[dict[str, Any]]] = {}
        self.checkpoints: dict[tuple[str, int], dict[str, Any]] = {}
        self.jobs: dict[str, dict[str, Any]] = {}

    @contextmanager
    def unit_of_work(self) -> Iterator[None]:
        with self._txn:
            yield

    def put_run(self, row: dict[str, Any]) -> None:
        with self._lock:
            self.runs[row["id"]] = row

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self.runs.get(run_id)
            return None if row is None else dict(row)

    def lock_run(self, run_id: str) -> dict[str, Any] | None:
        return self.get_run(run_id)

    def put_action(self, row: dict[str, Any]) -> None:
        with self._lock:
            self.actions[(row["run_id"], row["action_id"])] = row

    def get_action(self, run_id: str, action_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self.actions.get((run_id, action_id))
            return None if row is None else dict(row)

    def action_count(self, run_id: str) -> int:
        with self._lock:
            return sum(1 for key in self.actions if key[0] == run_id)

    def append_event(self, row: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            bucket = self.events.setdefault(row["run_id"], [])
            nxt = dict(row)
            nxt["seq"] = len(bucket) + 1
            bucket.append(nxt)
            return dict(nxt)

    def list_events(self, run_id: str, after: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(item) for item in self.events.get(run_id, []) if item["seq"] > after]

    def put_checkpoint(self, row: dict[str, Any]) -> None:
        with self._lock:
            self.checkpoints[(row["run_id"], int(row["revision"]))] = row

    def get_checkpoint(self, run_id: str, revision: int) -> dict[str, Any] | None:
        with self._lock:
            row = self.checkpoints.get((run_id, revision))
            return None if row is None else dict(row)

    def put_job(self, row: dict[str, Any]) -> None:
        with self._lock:
            self.jobs[row["id"]] = row

    def update_job(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            row = self.jobs.get(job_id)
            if row is None:
                return
            row.update(fields)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self.jobs.get(job_id)
            return None if row is None else dict(row)

    def jobs_for_revision(self, run_id: str, revision: int) -> list[dict[str, Any]]:
        with self._lock:
            return [
                dict(row)
                for row in self.jobs.values()
                if row["run_id"] == run_id and int(row["revision"]) == revision
            ]


class SqlGameStore:
    """Persists the five game tables. One unit_of_work == one SQL transaction."""

    def __init__(self, session_factory: sessionmaker[Session]):
        self._factory = session_factory
        self._local = threading.local()
        _ensure_sqlite_immediate(session_factory.kw.get("bind"))

    @contextmanager
    def unit_of_work(self) -> Iterator[None]:
        session = self._factory()
        self._local.session = session
        try:
            yield
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
            self._local.session = None

    def _session(self) -> Session:
        current = getattr(self._local, "session", None)
        if current is not None:
            return current
        return self._factory()

    def _close_if_borrowed(self, session: Session) -> None:
        if getattr(self._local, "session", None) is session:
            return
        session.close()

    def put_run(self, row: dict[str, Any]) -> None:
        from game.models import GameRun

        session = self._session()
        try:
            existing = session.get(GameRun, row["id"])
            payload = json.dumps(row["state"], ensure_ascii=False)
            if existing is None:
                session.add(
                    GameRun(
                        id=row["id"],
                        owner=row.get("owner") or "guest",
                        scenario_id=row.get("scenario_id") or "one_night_v1",
                        rules_version=int(row.get("rules_version") or 1),
                        seed=int(row.get("seed") or 1),
                        revision=int(row["revision"]),
                        status=row.get("status") or "active",
                        state_json=payload,
                        parent_run_id=row.get("parent_run_id"),
                        parent_revision=row.get("parent_revision"),
                    )
                )
            else:
                existing.owner = row.get("owner") or existing.owner
                existing.revision = int(row["revision"])
                existing.status = row.get("status") or existing.status
                existing.state_json = payload
                existing.parent_run_id = row.get("parent_run_id")
                existing.parent_revision = row.get("parent_revision")
            session.flush()
        finally:
            self._close_if_borrowed(session)

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        from game.models import GameRun

        session = self._session()
        try:
            row = session.get(GameRun, run_id)
            if row is None:
                return None
            return _run_to_dict(row)
        finally:
            self._close_if_borrowed(session)

    def lock_run(self, run_id: str) -> dict[str, Any] | None:
        from game.models import GameRun

        session = self._session()
        try:
            row = session.scalar(
                select(GameRun).where(GameRun.id == run_id).with_for_update()
            )
            if row is None:
                return None
            return _run_to_dict(row)
        finally:
            self._close_if_borrowed(session)

    def put_action(self, row: dict[str, Any]) -> None:
        from game.models import GameAction

        session = self._session()
        try:
            session.add(
                GameAction(
                    run_id=row["run_id"],
                    action_id=row["action_id"],
                    request_hash=row["request_hash"],
                    expected_revision=int(row["expected_revision"]),
                    accepted_revision=int(row["accepted_revision"]),
                    choice_id=row["choice_id"],
                    accepted_view_json=json.dumps(row["accepted_view"], ensure_ascii=False),
                )
            )
            session.flush()
        finally:
            self._close_if_borrowed(session)

    def get_action(self, run_id: str, action_id: str) -> dict[str, Any] | None:
        from game.models import GameAction

        session = self._session()
        try:
            row = session.scalar(
                select(GameAction).where(
                    GameAction.run_id == run_id,
                    GameAction.action_id == action_id,
                )
            )
            if row is None:
                return None
            return {
                "run_id": row.run_id,
                "action_id": row.action_id,
                "request_hash": row.request_hash,
                "expected_revision": row.expected_revision,
                "accepted_revision": row.accepted_revision,
                "choice_id": row.choice_id,
                "accepted_view": json.loads(row.accepted_view_json),
            }
        finally:
            self._close_if_borrowed(session)

    def action_count(self, run_id: str) -> int:
        from game.models import GameAction

        session = self._session()
        try:
            return int(
                session.scalar(select(func.count()).where(GameAction.run_id == run_id)) or 0
            )
        finally:
            self._close_if_borrowed(session)

    def append_event(self, row: dict[str, Any]) -> dict[str, Any]:
        from game.models import GameEvent

        session = self._session()
        try:
            nxt_seq = int(
                session.scalar(
                    select(func.max(GameEvent.seq)).where(GameEvent.run_id == row["run_id"])
                )
                or 0
            ) + 1
            session.add(
                GameEvent(
                    run_id=row["run_id"],
                    seq=nxt_seq,
                    revision=int(row["revision"]),
                    type=row["type"],
                    visibility=row.get("visibility") or "player",
                    source_action_id=row.get("source_action_id"),
                    payload_json=json.dumps(row.get("payload") or {}, ensure_ascii=False),
                )
            )
            session.flush()
            out = dict(row)
            out["seq"] = nxt_seq
            return out
        finally:
            self._close_if_borrowed(session)

    def list_events(self, run_id: str, after: int = 0) -> list[dict[str, Any]]:
        from game.models import GameEvent

        session = self._session()
        try:
            rows = session.scalars(
                select(GameEvent)
                .where(GameEvent.run_id == run_id, GameEvent.seq > int(after))
                .order_by(GameEvent.seq)
            ).all()
            return [
                {
                    "run_id": item.run_id,
                    "seq": item.seq,
                    "revision": item.revision,
                    "type": item.type,
                    "visibility": item.visibility,
                    "source_action_id": item.source_action_id,
                    "payload": json.loads(item.payload_json or "{}"),
                }
                for item in rows
            ]
        finally:
            self._close_if_borrowed(session)

    def put_checkpoint(self, row: dict[str, Any]) -> None:
        from game.models import GameCheckpoint

        session = self._session()
        try:
            existing = session.scalar(
                select(GameCheckpoint).where(
                    GameCheckpoint.run_id == row["run_id"],
                    GameCheckpoint.revision == int(row["revision"]),
                )
            )
            payload = json.dumps(row["state"], ensure_ascii=False)
            if existing is None:
                session.add(
                    GameCheckpoint(
                        run_id=row["run_id"],
                        revision=int(row["revision"]),
                        state_json=payload,
                        seed=int(row.get("seed") or 1),
                        parent_run_id=row.get("parent_run_id"),
                        source_action_id=row.get("source_action_id"),
                    )
                )
            else:
                existing.state_json = payload
                existing.source_action_id = row.get("source_action_id")
            session.flush()
        finally:
            self._close_if_borrowed(session)

    def get_checkpoint(self, run_id: str, revision: int) -> dict[str, Any] | None:
        from game.models import GameCheckpoint

        session = self._session()
        try:
            row = session.scalar(
                select(GameCheckpoint).where(
                    GameCheckpoint.run_id == run_id,
                    GameCheckpoint.revision == int(revision),
                )
            )
            if row is None:
                return None
            return {
                "run_id": row.run_id,
                "revision": row.revision,
                "state": json.loads(row.state_json),
                "seed": row.seed,
                "parent_run_id": row.parent_run_id,
                "source_action_id": row.source_action_id,
            }
        finally:
            self._close_if_borrowed(session)

    def put_job(self, row: dict[str, Any]) -> None:
        from game.models import PerformanceJob

        session = self._session()
        try:
            session.add(
                PerformanceJob(
                    id=row["id"],
                    run_id=row["run_id"],
                    action_id=row.get("action_id"),
                    revision=int(row["revision"]),
                    status=row.get("status") or "pending",
                    kind=row.get("kind") or "performance",
                )
            )
            session.flush()
        finally:
            self._close_if_borrowed(session)

    def update_job(self, job_id: str, **fields: Any) -> None:
        from game.models import PerformanceJob

        session = self._session()
        try:
            row = session.get(PerformanceJob, job_id)
            if row is None:
                return
            if "status" in fields and fields["status"] is not None:
                row.status = str(fields["status"])
            session.flush()
        finally:
            self._close_if_borrowed(session)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        from game.models import PerformanceJob

        session = self._session()
        try:
            row = session.get(PerformanceJob, job_id)
            if row is None:
                return None
            return _job_to_dict(row)
        finally:
            self._close_if_borrowed(session)

    def jobs_for_revision(self, run_id: str, revision: int) -> list[dict[str, Any]]:
        from game.models import PerformanceJob

        session = self._session()
        try:
            rows = session.scalars(
                select(PerformanceJob).where(
                    PerformanceJob.run_id == run_id,
                    PerformanceJob.revision == int(revision),
                )
            ).all()
            return [_job_to_dict(item) for item in rows]
        finally:
            self._close_if_borrowed(session)


def _ensure_sqlite_immediate(bind: Any) -> None:
    if bind is None or bind.dialect.name != "sqlite":
        return
    if getattr(bind, "_bb_immediate_begin", False):
        return

    @event.listens_for(bind, "connect")
    def _sqlite_connect(dbapi_connection, _connection_record) -> None:
        dbapi_connection.isolation_level = None

    @event.listens_for(bind, "begin")
    def _sqlite_begin(conn) -> None:
        conn.exec_driver_sql("BEGIN IMMEDIATE")

    bind._bb_immediate_begin = True


def _run_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "owner": row.owner,
        "scenario_id": row.scenario_id,
        "rules_version": row.rules_version,
        "seed": row.seed,
        "revision": row.revision,
        "status": row.status,
        "state": json.loads(row.state_json),
        "parent_run_id": row.parent_run_id,
        "parent_revision": row.parent_revision,
    }


def _job_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "run_id": row.run_id,
        "action_id": row.action_id,
        "revision": row.revision,
        "status": row.status,
        "kind": row.kind,
    }


def default_store() -> SqlGameStore:
    from config import settings
    from db.url import render_engine_url

    url = make_url(settings.database_url)
    if url.get_backend_name() == "postgresql" and "+asyncpg" in url.drivername:
        url = url.set(drivername="postgresql+psycopg2")
    engine = create_engine(render_engine_url(url), pool_pre_ping=True)
    return SqlGameStore(sessionmaker(bind=engine, expire_on_commit=False))
