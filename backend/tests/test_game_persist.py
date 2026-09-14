"""Settlement must survive a new store instance (process-equivalent restart)."""

from __future__ import annotations

import os

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db.session import Base
from game.service import GameService
from game.store import SqlGameStore


def test_game_tables_registered_once_on_shared_base():
    import db.models
    import game.models

    assert not hasattr(db.models, "GameRun")
    assert game.models.GameRun.__table__.name == "game_runs"
    assert list(Base.metadata.tables).count("game_runs") == 1


def _engine():
    import game.models  # noqa: F401 — register tables on Base.metadata

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine


def test_start_action_then_new_store_recovers_revision_and_meters():
    engine = _engine()
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    first = GameService(SqlGameStore(factory))
    start = first.start(seed=3)
    acted = first.act(
        start["run_id"],
        action_id="persist-1",
        expected_revision=start["revision"],
        choice_id="listen_jesse",
    )
    assert acted["revision"] == 1

    restarted = GameService(SqlGameStore(factory))
    view = restarted.get(start["run_id"])
    assert view["revision"] == acted["revision"]
    assert view["meters"] == acted["meters"]
    assert view["resources"] == acted["resources"]
    events = restarted.events(start["run_id"], after=0)
    assert [item["seq"] for item in events] == sorted(item["seq"] for item in events)
    assert events[-1]["revision"] == acted["revision"]
    assert restarted.store.action_count(start["run_id"]) == 1
    jobs = restarted.store.jobs_for_revision(start["run_id"], acted["revision"])
    assert jobs and jobs[0]["status"] == "pending"


def test_http_get_and_events_survive_new_store():
    from fastapi.testclient import TestClient

    from api.game_routes import get_game_service
    from main import app

    engine = _engine()
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    app.dependency_overrides[get_game_service] = lambda: GameService(SqlGameStore(factory))
    try:
        with TestClient(app) as client:
            start = client.post("/api/game/start", json={"seed": 3}).json()
            acted = client.post(
                f"/api/game/{start['run_id']}/actions",
                json={
                    "action_id": "persist-http-1",
                    "expected_revision": start["revision"],
                    "choice_id": "listen_jesse",
                },
            ).json()["view"]
    finally:
        app.dependency_overrides.clear()

    app.dependency_overrides[get_game_service] = lambda: GameService(SqlGameStore(factory))
    try:
        with TestClient(app) as client:
            view = client.get(f"/api/game/{start['run_id']}").json()
            events = client.get(f"/api/game/{start['run_id']}/events", params={"after": 0}).json()
    finally:
        app.dependency_overrides.clear()

    assert view["revision"] == acted["revision"]
    assert view["meters"] == acted["meters"]
    assert events["events"][-1]["revision"] == acted["revision"]


def test_failed_settlement_does_not_commit():
    engine = _engine()
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    first = GameService(SqlGameStore(factory))
    start = first.start(seed=3)

    original = first.store.put_job

    def boom(row):
        original(row)
        raise RuntimeError("forced job failure")

    first.store.put_job = boom  # type: ignore[method-assign]
    try:
        first.act(
            start["run_id"],
            action_id="persist-fail",
            expected_revision=start["revision"],
            choice_id="listen_jesse",
        )
        raise AssertionError("act should have failed")
    except RuntimeError:
        pass

    restarted = GameService(SqlGameStore(factory))
    view = restarted.get(start["run_id"])
    assert view["revision"] == start["revision"]
    assert restarted.store.action_count(start["run_id"]) == 0
    assert restarted.store.jobs_for_revision(start["run_id"], 1) == []


def test_concurrent_different_actions_one_revision_conflict(tmp_path):
    import threading

    from game.service import GameError

    import game.models  # noqa: F401

    db_path = tmp_path / "lock.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    start = GameService(SqlGameStore(factory)).start(seed=3)
    barrier = threading.Barrier(2)
    results: list[tuple[str, object]] = []

    def worker(action_id: str, choice_id: str) -> None:
        svc = GameService(SqlGameStore(factory))
        barrier.wait()
        try:
            view = svc.act(
                start["run_id"],
                action_id=action_id,
                expected_revision=start["revision"],
                choice_id=choice_id,
            )
            results.append(("ok", view["revision"]))
        except GameError as exc:
            results.append(("err", exc.code))

    threads = [
        threading.Thread(target=worker, args=("a-listen", "listen_jesse")),
        threading.Thread(target=worker, args=("a-home", "go_home")),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    oks = [row for row in results if row[0] == "ok"]
    errs = [row for row in results if row[0] == "err"]
    assert len(oks) == 1, results
    assert oks[0][1] == 1
    assert errs == [("err", "revision_conflict")], results
    review = GameService(SqlGameStore(factory)).get(start["run_id"])
    assert review["revision"] == 1
    assert SqlGameStore(factory).action_count(start["run_id"]) == 1
