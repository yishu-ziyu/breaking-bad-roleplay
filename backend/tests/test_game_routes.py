"""HTTP contract for the P0 Game Kernel. No LLM, no database writes."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

from api.routes import get_db  # noqa: E402
from game.store import game_store  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture
def client():
    game_store.clear()
    app.dependency_overrides[get_db] = lambda: None
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()
        game_store.clear()


def _start(client: TestClient, seed: int = 59) -> dict:
    resp = client.post("/api/game/start", json={"seed": seed, "language": "en"})
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestGameRoutes:
    def test_start_returns_opening_night(self, client):
        body = _start(client)
        assert body["state"]["turn"] == 0
        assert body["event"]["id"] == "night_opens"
        assert {a["id"] for a in body["available_actions"]} >= {"lie_to_skyler", "clean_rv"}
        assert body["ending"] is None
        assert body["performance"]["character_id"] == "walter"

    def test_get_round_trips_state(self, client):
        started = _start(client)
        resp = client.get(f"/api/game/{started['game_id']}")
        assert resp.status_code == 200
        assert resp.json()["state"]["seed"] == 59

    def test_action_returns_settlement_contract(self, client):
        started = _start(client)
        resp = client.post(
            f"/api/game/{started['game_id']}/action",
            json={"action_id": "lie_to_skyler"},
        )
        assert resp.status_code == 200
        body = resp.json()
        for key in (
            "previous_state",
            "action",
            "resolved_effects",
            "npc_actions",
            "triggered_debts",
            "next_state",
            "next_event",
            "ending",
        ):
            assert key in body
        assert body["action"]["id"] == "lie_to_skyler"
        assert body["next_state"]["family_suspicion"] == started["state"]["family_suspicion"] - 1
        assert any(d["id"] == "elliott_alibi" for d in body["next_state"]["debts"])
        assert body["npc_actions"]

    def test_six_turns_end_without_llm(self, client):
        started = _start(client)
        game_id = started["game_id"]
        sequence = [
            "lie_to_skyler",
            "clean_rv",
            "pay_jesse",
            "chase_jesse",
            "call_saul",
            "stay_home",
        ]
        last = None
        for action_id in sequence:
            resp = client.post(f"/api/game/{game_id}/action", json={"action_id": action_id})
            assert resp.status_code == 200, resp.text
            last = resp.json()
        assert last is not None
        assert last["next_state"]["ended"] is True
        assert last["ending"]["kind"] in {"win", "loss", "cost"}

    def test_unknown_game_404(self, client):
        assert client.get("/api/game/missing").status_code == 404
        assert client.post("/api/game/missing/action", json={"action_id": "stay_home"}).status_code == 404

    def test_illegal_action_400(self, client):
        started = _start(client)
        resp = client.post(
            f"/api/game/{started['game_id']}/action",
            json={"action_id": "cook_product"},
        )
        assert resp.status_code == 400
