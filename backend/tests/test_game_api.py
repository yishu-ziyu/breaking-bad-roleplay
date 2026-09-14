"""M2: command API is the authority. No LLM, no real Postgres."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor

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


def _client():
    store = MemoryGameStore()
    service = GameService(store)
    app.dependency_overrides[get_game_service] = lambda: service
    app.dependency_overrides[get_performance_provider] = lambda: None
    try:
        with TestClient(app) as client:
            yield client, service, store
    finally:
        app.dependency_overrides.clear()


def test_t1_same_action_id_ten_times_settles_once():
    for client, _svc, store in _client():
        start = client.post("/api/game/start", json={"seed": 3}).json()
        run_id = start["run_id"]
        body = {
            "action_id": "act-listen-1",
            "expected_revision": start["revision"],
            "choice_id": "listen_jesse",
        }
        replies = [client.post(f"/api/game/{run_id}/actions", json=body) for _ in range(10)]
        assert all(row.status_code == 200 for row in replies)
        views = [row.json()["view"] for row in replies]
        assert {v["revision"] for v in views} == {1}
        assert {v["resources"]["saul_favor"] for v in views} == {start["resources"]["saul_favor"]}
        assert store.action_count(run_id) == 1
        assert views[0]["meters"]["jesse_trust"] == start["meters"]["jesse_trust"] + 1


def test_stale_revision_conflicts_and_does_not_apply():
    for client, _svc, store in _client():
        start = client.post("/api/game/start", json={"seed": 3}).json()
        run_id = start["run_id"]
        first = client.post(
            f"/api/game/{run_id}/actions",
            json={
                "action_id": "a1",
                "expected_revision": 0,
                "choice_id": "listen_jesse",
            },
        )
        assert first.status_code == 200
        after = first.json()["view"]
        stale = client.post(
            f"/api/game/{run_id}/actions",
            json={
                "action_id": "a2",
                "expected_revision": 0,
                "choice_id": "go_home",
            },
        )
        assert stale.status_code == 409
        body = stale.json()
        assert body["code"] == "revision_conflict"
        current = client.get(f"/api/game/{run_id}").json()
        assert current["revision"] == after["revision"]
        assert current["location"] == after["location"]
        assert store.action_count(run_id) == 1


def test_same_action_id_different_body_is_rejected():
    for client, _svc, store in _client():
        start = client.post("/api/game/start", json={"seed": 3}).json()
        run_id = start["run_id"]
        ok = client.post(
            f"/api/game/{run_id}/actions",
            json={
                "action_id": "same",
                "expected_revision": 0,
                "choice_id": "listen_jesse",
            },
        )
        assert ok.status_code == 200
        clash = client.post(
            f"/api/game/{run_id}/actions",
            json={
                "action_id": "same",
                "expected_revision": 0,
                "choice_id": "go_home",
            },
        )
        assert clash.status_code == 409
        assert clash.json()["code"] == "idempotency_mismatch"
        assert store.action_count(run_id) == 1


def test_get_is_review_and_events_replay_without_llm():
    for client, svc, store in _client():
        start = client.post("/api/game/start", json={"seed": 3}).json()
        run_id = start["run_id"]
        client.post(
            f"/api/game/{run_id}/actions",
            json={"action_id": "e1", "expected_revision": 0, "choice_id": "listen_jesse"},
        )
        review = client.get(f"/api/game/{run_id}")
        assert review.status_code == 200
        assert review.json()["revision"] == 1
        events = client.get(f"/api/game/{run_id}/events", params={"after": 0})
        assert events.status_code == 200
        seqs = [item["seq"] for item in events.json()["events"]]
        assert seqs == sorted(seqs)
        assert seqs[0] == 1
        later = client.get(f"/api/game/{run_id}/events", params={"after": 1})
        assert all(item["seq"] > 1 for item in later.json()["events"])
        src = open(svc.__class__.__module__.replace(".", "/") if False else svc.__class__.__module__, encoding="utf-8") if False else None
        del src
        text = open(__import__("game.service", fromlist=["x"]).__file__, encoding="utf-8").read()
        assert "call_model" not in text
        assert "ProviderFacade" not in text
        jobs = store.jobs_for_revision(run_id, 1)
        assert jobs and jobs[0]["status"] == "pending"


def test_replay_does_not_recost_and_enqueues_new_job():
    for client, _svc, store in _client():
        start = client.post("/api/game/start", json={"seed": 3}).json()
        run_id = start["run_id"]
        acted = client.post(
            f"/api/game/{run_id}/actions",
            json={"action_id": "e1", "expected_revision": 0, "choice_id": "listen_jesse"},
        ).json()["view"]
        before_jobs = len(store.jobs_for_revision(run_id, acted["revision"]))
        replay = client.post(f"/api/game/{run_id}/replay", json={"revision": acted["revision"]})
        assert replay.status_code == 200
        after = client.get(f"/api/game/{run_id}").json()
        assert after["revision"] == acted["revision"]
        assert after["meters"] == acted["meters"]
        assert after["resources"] == acted["resources"]
        assert store.action_count(run_id) == 1
        assert len(store.jobs_for_revision(run_id, acted["revision"])) == before_jobs + 1


def test_branch_copies_checkpoint_and_does_not_leak():
    for client, _svc, store in _client():
        start = client.post("/api/game/start", json={"seed": 3}).json()
        run_id = start["run_id"]
        client.post(
            f"/api/game/{run_id}/actions",
            json={"action_id": "p1", "expected_revision": 0, "choice_id": "listen_jesse"},
        )
        parent = client.get(f"/api/game/{run_id}").json()
        branched = client.post(
            f"/api/game/{run_id}/branches",
            json={"revision": parent["revision"]},
        )
        assert branched.status_code == 200
        child = branched.json()
        assert child["run_id"] != run_id
        assert child["revision"] == parent["revision"]
        assert child["meters"] == parent["meters"]
        child_act = client.post(
            f"/api/game/{child['run_id']}/actions",
            json={
                "action_id": "c1",
                "expected_revision": child["revision"],
                "choice_id": "stash_the_bag",
            },
        )
        assert child_act.status_code == 200
        parent_after = client.get(f"/api/game/{run_id}").json()
        child_after = client.get(f"/api/game/{child['run_id']}").json()
        assert parent_after["revision"] == parent["revision"]
        assert parent_after["resources"]["cash"] == parent["resources"]["cash"]
        assert child_after["resources"]["cash"] == parent["resources"]["cash"] - 1
        assert store.action_count(run_id) == 1
        assert store.action_count(child["run_id"]) == 1


def test_get_history_lists_six_actions_and_ending_traces_them():
    for client, _svc, _store in _client():
        start = client.post("/api/game/start", json={"seed": 11}).json()
        run_id = start["run_id"]
        revision = start["revision"]
        path = ["listen_jesse", "stash_the_bag", "go_home", "stall", "stall", "stall"]
        view = start
        for index, choice in enumerate(path, start=1):
            acted = client.post(
                f"/api/game/{run_id}/actions",
                json={
                    "action_id": f"hist-{index}",
                    "expected_revision": revision,
                    "choice_id": choice,
                },
            )
            assert acted.status_code == 200, acted.text
            view = acted.json()["view"]
            revision = view["revision"]
        review = client.get(f"/api/game/{run_id}").json()
        players = [item for item in review["history"] if item.get("source") == "player"]
        assert [item["action_id"] for item in players] == path
        assert all(item.get("cost_text") for item in players)
        assert all(item.get("label") for item in players)
        assert review["ending"]
        assert [c["action_id"] for c in review["ending"]["causes"]] == path
        assert review["ending"]["causes"][0]["label"]


def test_concurrent_same_action_id_still_once():
    for client, _svc, store in _client():
        start = client.post("/api/game/start", json={"seed": 3}).json()
        run_id = start["run_id"]
        body = {
            "action_id": "race-1",
            "expected_revision": 0,
            "choice_id": "listen_jesse",
        }

        def post_once():
            return client.post(f"/api/game/{run_id}/actions", json=body).status_code

        with ThreadPoolExecutor(max_workers=10) as pool:
            codes = list(pool.map(lambda _: post_once(), range(10)))
        assert set(codes) <= {200}
        assert store.action_count(run_id) == 1
        assert client.get(f"/api/game/{run_id}").json()["revision"] == 1
