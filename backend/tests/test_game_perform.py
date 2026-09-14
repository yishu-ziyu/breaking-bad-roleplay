"""After settlement commits, fulfill may fail. The night does not roll back."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

from fastapi.testclient import TestClient

from api.game_routes import get_game_service, get_performance_provider
from game.service import GameService
from game.store import MemoryGameStore
from main import app

LISTEN_FALLBACK = "他一股脑倒出来：有人在找这个包。他要你今晚别把他丢在门外。"
READY_LINE = "包是烫的。你今晚别把门关上。"


def _provider(*, side_effect=None, return_value=None):
    provider = MagicMock()
    if side_effect is not None:
        provider.call_model = AsyncMock(side_effect=side_effect)
    else:
        provider.call_model = AsyncMock(return_value=return_value)
    return provider


def _client(provider):
    store = MemoryGameStore()
    service = GameService(store)
    app.dependency_overrides[get_game_service] = lambda: service
    app.dependency_overrides[get_performance_provider] = lambda: provider
    try:
        with TestClient(app) as client:
            yield client, service, store
    finally:
        app.dependency_overrides.clear()


def test_provider_fail_after_act_keeps_revision_and_uses_fallback():
    provider = _provider(side_effect=TimeoutError("slow"))
    for client, _svc, store in _client(provider):
        start = client.post("/api/game/start", json={"seed": 3}).json()
        acted = client.post(
            f"/api/game/{start['run_id']}/actions",
            json={
                "action_id": "perf-fail",
                "expected_revision": start["revision"],
                "choice_id": "listen_jesse",
            },
        )
        assert acted.status_code == 200
        view = acted.json()["view"]
        assert view["revision"] == 1
        assert view["meters"]["jesse_trust"] == start["meters"]["jesse_trust"] + 1
        assert view["line"] == LISTEN_FALLBACK
        assert view["performance"]["status"] == "fallback"
        assert view["performance"]["used_fallback"] is True

        review = client.get(f"/api/game/{start['run_id']}").json()
        assert review["revision"] == 1
        assert review["meters"] == view["meters"]
        assert review["resources"] == view["resources"]
        assert review["line"] == LISTEN_FALLBACK
        jobs = store.jobs_for_revision(start["run_id"], 1)
        assert jobs and jobs[0]["status"] == "fallback"
        assert store.action_count(start["run_id"]) == 1


def test_provider_success_keeps_post_settle_meters():
    provider = _provider(return_value='{"speaker":"jesse","line":"%s"}' % READY_LINE)
    for client, _svc, store in _client(provider):
        start = client.post("/api/game/start", json={"seed": 3}).json()
        acted = client.post(
            f"/api/game/{start['run_id']}/actions",
            json={
                "action_id": "perf-ok",
                "expected_revision": start["revision"],
                "choice_id": "listen_jesse",
            },
        )
        assert acted.status_code == 200
        view = acted.json()["view"]
        settled_meters = view["meters"]
        assert view["revision"] == 1
        assert view["line"] == READY_LINE
        assert view["performance"]["status"] == "ready"
        assert view["performance"]["used_fallback"] is False

        review = client.get(f"/api/game/{start['run_id']}").json()
        assert review["revision"] == 1
        assert review["meters"] == settled_meters
        assert review["resources"] == view["resources"]
        assert review["line"] == READY_LINE
        jobs = store.jobs_for_revision(start["run_id"], 1)
        assert jobs and jobs[0]["status"] == "ready"


def test_replay_fulfills_without_recosting():
    provider = _provider(return_value='{"speaker":"jesse","line":"%s"}' % READY_LINE)
    for client, _svc, store in _client(provider):
        start = client.post("/api/game/start", json={"seed": 3}).json()
        acted = client.post(
            f"/api/game/{start['run_id']}/actions",
            json={
                "action_id": "perf-replay",
                "expected_revision": start["revision"],
                "choice_id": "listen_jesse",
            },
        ).json()["view"]
        replay = client.post(
            f"/api/game/{start['run_id']}/replay",
            json={"revision": acted["revision"]},
        )
        assert replay.status_code == 200
        body = replay.json()
        assert body["revision"] == acted["revision"]
        assert body["status"] in {"ready", "fallback"}
        review = client.get(f"/api/game/{start['run_id']}").json()
        assert review["revision"] == acted["revision"]
        assert review["meters"] == acted["meters"]
        assert review["resources"] == acted["resources"]
        assert store.action_count(start["run_id"]) == 1
        jobs = store.jobs_for_revision(start["run_id"], acted["revision"])
        assert len(jobs) == 2
        assert {job["status"] for job in jobs} <= {"ready", "fallback"}
