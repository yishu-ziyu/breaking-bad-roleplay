"""P0/P1 security hardening: quota IP, SSRF routes, live harness quota, payloads."""

from __future__ import annotations

import os
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

import pytest
from fastapi.testclient import TestClient

from agents import quota as quota_mod
from agents.quota import client_ip, enforce_platform_quota
from agents.session_guard import hash_session_key
from api.routes import get_db
from main import app


class _FakeClient:
    def __init__(self, host: str = "10.0.0.9"):
        self.host = host


class _FakeRequest:
    def __init__(self, ip: str = "10.0.0.9", headers: dict | None = None):
        self.client = _FakeClient(ip)
        self.headers = headers or {}


def test_client_ip_ignores_spoofed_x_forwarded_for():
    req = _FakeRequest(ip="203.0.113.10", headers={"X-Forwarded-For": "1.2.3.4"})
    assert client_ip(req) == "203.0.113.10"


def test_client_ip_prefers_x_real_ip():
    req = _FakeRequest(
        ip="127.0.0.1",
        headers={"X-Real-IP": "203.0.113.20", "X-Forwarded-For": "1.2.3.4"},
    )
    assert client_ip(req) == "203.0.113.20"


def test_client_ip_rejects_garbage_x_real_ip():
    req = _FakeRequest(ip="203.0.113.10", headers={"X-Real-IP": "not-an-ip"})
    assert client_ip(req) == "203.0.113.10"


@pytest.fixture
def client():
    db = MagicMock()
    db.execute = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    app.dependency_overrides[get_db] = lambda: db
    try:
        with TestClient(app) as c:
            yield c, db
    finally:
        app.dependency_overrides.clear()


def test_connections_test_rejects_private_base_url(client):
    c, _db = client
    resp = c.post(
        "/api/connections/test",
        json={
            "providerId": "custom",
            "apiKey": "sk-test",
            "baseUrl": "http://127.0.0.1:9/v1",
        },
    )
    assert resp.status_code == 400
    assert "baseUrl" in resp.json()["detail"] or "private" in str(resp.json()["detail"]).lower()


def test_connections_bind_rejects_metadata_url(client):
    c, _db = client
    resp = c.post(
        "/api/connections/bind",
        json={
            "providerId": "custom",
            "llmKey": "sk-test",
            "baseUrl": "http://169.254.169.254/latest/meta-data",
        },
    )
    assert resp.status_code == 400


def test_chat_rejects_oversized_input(client):
    c, _db = client
    resp = c.post(
        "/api/chat",
        json={
            "characterId": "walter",
            "userInput": "x" * 5001,
            "mode": "direct",
        },
    )
    assert resp.status_code == 422


def test_session_create_rejects_oversized_task(client):
    c, _db = client
    resp = c.post(
        "/api/session/create",
        json={"title": "t", "task_prompt": "y" * 5001},
    )
    assert resp.status_code == 422


def test_session_create_returns_session_key(client):
    c, db = client
    resp = c.post(
        "/api/session/create",
        json={"title": "Walt", "task_prompt": "Need leverage."},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("session_key")
    added = db.add.call_args.args[0]
    assert added.owner_token_hash
    assert added.owner_token_hash != body["session_key"]
    assert added.owner_token_hash == hash_session_key(body["session_key"])


def test_session_action_rejects_wrong_key(client):
    c, db = client
    session = SimpleNamespace(
        id="sess-locked",
        status="active",
        task_prompt="x",
        title="t",
        plot_outline="1. a",
        next_beat_index=0,
        active_character_id="walter",
        owner_token_hash=hash_session_key("correct-key"),
        updated_at=datetime.utcnow(),
    )
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=session)
    db.execute = AsyncMock(return_value=result)
    resp = c.post(
        "/api/session/sess-locked/action",
        json={"action": "continue"},
        headers={"X-Session-Key": "wrong-key"},
    )
    assert resp.status_code == 403


def test_session_action_accepts_matching_key(client):
    c, db = client
    session = SimpleNamespace(
        id="sess-locked",
        status="paused",
        task_prompt="x",
        title="t",
        plot_outline="1. a",
        next_beat_index=0,
        active_character_id="walter",
        owner_token_hash=hash_session_key("correct-key"),
        updated_at=datetime.utcnow(),
    )
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=session)
    db.execute = AsyncMock(return_value=result)
    resp = c.post(
        "/api/session/sess-locked/action",
        json={"action": "continue"},
        headers={"X-Session-Key": "correct-key"},
    )
    assert resp.status_code == 200
    assert session.status == "active"


def test_agent_run_live_is_metered():
    quota_mod.settings.free_credits_guest = 0
    quota_mod.settings.platform_daily_credit_budget = 0
    quota_mod.settings.platform_rate_limit_per_hour = 100_000
    store = quota_mod._store
    mem = store._memory if hasattr(store, "_memory") else store
    with mem._lock:
        mem._used.clear()
        mem._global.clear()
        mem._hits.clear()
    with patch("api.routes._live_provider_available", return_value=True):
        with TestClient(app) as c:
            resp = c.post(
                "/api/agent/run",
                json={"message": "hello", "offline": False, "character_id": "walter"},
            )
    assert resp.status_code in (402, 429)


def test_agent_run_offline_skips_llm_quota():
    quota_mod.settings.free_credits_guest = 0
    quota_mod.settings.platform_daily_credit_budget = 0
    quota_mod.settings.platform_rate_limit_per_hour = 100_000
    store = quota_mod._store
    mem = store._memory if hasattr(store, "_memory") else store
    with mem._lock:
        mem._used.clear()
        mem._global.clear()
        mem._hits.clear()
    with TestClient(app) as c:
        resp = c.post(
            "/api/agent/run",
            json={"message": "列出可玩角色", "offline": True, "character_id": "walter"},
        )
    assert resp.status_code == 200
    assert resp.json().get("reply")


def test_trajectories_api_redacts_user_text():
    from agents.harness.evolution import reset_lesson_store_for_tests
    from agents.harness.service import AgentHarnessService
    from agents.harness.trajectory import reset_trajectory_store_for_tests

    reset_trajectory_store_for_tests()
    reset_lesson_store_for_tests()

    async def _run():
        await AgentHarnessService().run(
            "secret player confession about family",
            offline=True,
            character_id="walter",
        )

    import asyncio

    asyncio.get_event_loop().run_until_complete(_run()) if False else None
    # pytest-asyncio not required — run via TestClient which already ran a message
    with TestClient(app) as c:
        c.post(
            "/api/agent/run",
            json={
                "message": "secret player confession about family",
                "offline": True,
                "character_id": "walter",
            },
        )
        listed = c.get("/api/agent/trajectories?limit=5")
    assert listed.status_code == 200
    blob = listed.text
    assert "secret player confession" not in blob


def test_action_cost_session_create_is_zero():
    from agents.quota import action_cost

    assert action_cost("session_create") == 0
