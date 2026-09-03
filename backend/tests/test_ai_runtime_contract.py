"""Python <-> Node contract: resolve first, AI cannot write or roll back GameState."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock

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
os.environ.setdefault("AI_RUNTIME", "legacy")

from api import game_routes  # noqa: E402
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


def test_legacy_flag_uses_template(client, monkeypatch):
    monkeypatch.setattr(game_routes.settings, "ai_runtime", "legacy")
    started = client.post("/api/game/start", json={"seed": 59}).json()
    resp = client.post(
        f"/api/game/{started['game_id']}/action",
        json={"action_id": "lie_to_skyler"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["performance"]["source"] == "template"
    assert body["next_state"]["family_suspicion"] == started["state"]["family_suspicion"] - 1


def test_pi_crash_does_not_rollback(client, monkeypatch):
    monkeypatch.setattr(game_routes.settings, "ai_runtime", "pi")
    monkeypatch.setattr(
        game_routes,
        "_ai_client",
        lambda: type(
            "Boom",
            (),
            {
                "perform": AsyncMock(side_effect=RuntimeError("sidecar down")),
                "dispose": AsyncMock(),
            },
        )(),
    )
    started = client.post("/api/game/start", json={"seed": 59}).json()
    before = started["state"]
    # start also calls attach_performance; crash must still persist the game
    stored = game_store.get(started["game_id"])
    assert stored is not None
    assert stored.state.police_risk == before["police_risk"]

    resp = client.post(
        f"/api/game/{started['game_id']}/action",
        json={"action_id": "lie_to_skyler"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["next_state"]["family_suspicion"] == before["family_suspicion"] - 1
    assert any(d["id"] == "elliott_alibi" for d in body["next_state"]["debts"])
    assert body["performance"]["source"] == "template"
    assert "game_state_delta" not in body["performance"]


def test_resolved_beat_is_serializable(client):
    started = client.post("/api/game/start", json={"seed": 59}).json()
    body = client.post(
        f"/api/game/{started['game_id']}/action",
        json={"action_id": "clean_rv"},
    ).json()
    beat = body["resolved_beat"]
    assert beat["player_action"]["id"] == "clean_rv"
    assert "visible_state" in beat
    assert "police_risk" in beat["visible_state"]


def test_sse_does_not_expose_thinking(client):
    started = client.post("/api/game/start", json={"seed": 59}).json()
    client.post(f"/api/game/{started['game_id']}/action", json={"action_id": "stay_home"})
    resp = client.post(f"/api/game/{started['game_id']}/perform/stream")
    assert resp.status_code == 200
    text = resp.text
    assert "thinking" not in text
    assert "event: done" in text
