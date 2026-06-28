"""Cycle 35 — API routes test coverage (L2 partial).

Covers the most critical user-facing API paths in api/routes.py:
  - POST /api/session/create (success + validation errors)
  - POST /api/session/{id}/action (continue/stop/invalid/missing session
    + redirect/switch_perspective validation)
  - GET /api/health

Mock strategy
-------------
- DB: ``app.dependency_overrides[get_db]`` returns a mock AsyncSession so
  tests never touch real Postgres (aiosqlite is not installed, so in-memory
  SQLite is not an option).
- Lifespan: ``db.session.engine.begin`` is patched to a no-op async context
  manager so FastAPI startup (which runs ``Base.metadata.create_all`` against
  the real DATABASE_URL) does not try to connect to Postgres.
- Director/Provider: not invoked by the routes under test, so the real
  singletons created in lifespan simply sit unused on ``app.state``.

The SSE ``/api/session/{id}/stream`` endpoint is deferred to a later cycle —
it requires async streaming assertions that don't fit the TestClient
request/response model cleanly.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Settings() reads env vars at import time. Set fakes BEFORE importing main
# so the module can be imported in CI without a .env file. ``setdefault``
# avoids overriding real values when a .env file is present locally.
os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

from api.routes import get_db  # noqa: E402
from main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_db():
    """Mock AsyncSession for route dependency injection.

    Mirrors the conftest mock_db but adds ``refresh`` (AsyncMock) because
    ``create_session`` calls ``await db.refresh(new_session)``.
    """
    db = MagicMock()
    db.execute = AsyncMock()
    db.add = MagicMock()  # sync on real AsyncSession
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    return db


@pytest.fixture
def client(mock_db):
    """TestClient with ``get_db`` overridden and lifespan DB init neutralized.

    The ``engine`` reference in ``main`` is replaced with a fake whose
    ``begin()`` returns a no-op async context manager, so the FastAPI lifespan
    startup (which runs ``Base.metadata.create_all`` against the real
    DATABASE_URL) does not try to connect to Postgres. The lifespan still
    constructs real ``ProviderFacade`` / ``DirectorAgent`` singletons on
    ``app.state``, but they are unused because the routes under test do not
    depend on ``get_director`` / ``get_provider``.

    We patch ``main.engine`` (not ``engine.begin`` directly) because
    SQLAlchemy's ``AsyncEngine.begin`` is a read-only descriptor that
    cannot be overwritten via ``setattr``.
    """
    app.dependency_overrides[get_db] = lambda: mock_db

    @asynccontextmanager
    async def _fake_engine_begin():
        class _FakeConn:
            # Lifespan does `await conn.run_sync(Base.metadata.create_all)`,
            # so run_sync must return an awaitable.
            async def run_sync(self, fn):
                return None

        yield _FakeConn()

    fake_engine = MagicMock()
    fake_engine.begin = _fake_engine_begin

    try:
        with patch("main.engine", fake_engine):
            with TestClient(app) as c:
                yield c
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _scalar_result(value):
    """Build a mock SQLAlchemy Result whose ``scalar_one_or_none()`` returns
    ``value`` (a Session row or None)."""
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    return result


def _make_session_row(
    session_id: str = "sess-123",
    status: str = "active",
    task_prompt: str = "Cook a batch in the RV",
):
    """Build a mock Session row that ``session_action`` can read and mutate."""
    session = MagicMock()
    session.id = session_id
    session.status = status
    session.task_prompt = task_prompt
    return session


# ---------------------------------------------------------------------------
# GET /api/health
# ---------------------------------------------------------------------------


class TestHealth:
    def test_health_returns_ok(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["service"] == "breaking-bad-roleplay"


# ---------------------------------------------------------------------------
# POST /api/session/create
# ---------------------------------------------------------------------------


class TestCreateSession:
    def test_create_session_success(self, client, mock_db):
        payload = {
            "title": "Walt & Jesse cook",
            "task_prompt": "Cook a batch in the RV",
        }
        resp = client.post("/api/session/create", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert "session_id" in body
        assert isinstance(body["session_id"], str)
        assert len(body["session_id"]) > 0
        assert body["title"] == payload["title"]
        assert body["status"] == "active"
        # created_at is ISO-format (Pydantic serialises datetime → ISO string)
        datetime.fromisoformat(body["created_at"])
        # DB was touched: one add, one commit, one refresh
        assert mock_db.add.call_count == 1
        assert mock_db.commit.await_count == 1
        assert mock_db.refresh.await_count == 1

    def test_create_session_missing_task_prompt_returns_422(self, client):
        resp = client.post("/api/session/create", json={"title": "x"})
        assert resp.status_code == 422

    def test_create_session_missing_title_returns_422(self, client):
        resp = client.post(
            "/api/session/create", json={"task_prompt": "do something"}
        )
        assert resp.status_code == 422

    def test_create_session_empty_body_returns_422(self, client):
        resp = client.post("/api/session/create", json={})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/session/{id}/action
# ---------------------------------------------------------------------------


class TestSessionAction:
    def test_action_continue_returns_200(self, client, mock_db):
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )
        resp = client.post(
            "/api/session/sess-123/action",
            json={"action": "continue"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["session_id"] == "sess-123"

    def test_action_stop_sets_status_paused(self, client, mock_db):
        session = _make_session_row(status="active")
        mock_db.execute = AsyncMock(return_value=_scalar_result(session))
        resp = client.post(
            "/api/session/sess-123/action",
            json={"action": "stop"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        # The route sets session.status = "paused" before committing.
        assert session.status == "paused"
        assert mock_db.commit.await_count >= 1

    def test_action_invalid_returns_400(self, client, mock_db):
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )
        resp = client.post(
            "/api/session/sess-123/action",
            json={"action": "fly_to_moon"},
        )
        assert resp.status_code == 400
        assert "Unknown action" in resp.json()["detail"]

    def test_action_unknown_session_returns_404(self, client, mock_db):
        mock_db.execute = AsyncMock(return_value=_scalar_result(None))
        resp = client.post(
            "/api/session/does-not-exist/action",
            json={"action": "continue"},
        )
        assert resp.status_code == 404
        assert "Session not found" in resp.json()["detail"]

    def test_action_redirect_missing_prompt_returns_400(self, client, mock_db):
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )
        resp = client.post(
            "/api/session/sess-123/action",
            json={"action": "redirect"},
        )
        assert resp.status_code == 400
        assert "redirect_prompt" in resp.json()["detail"]

    def test_action_switch_perspective_missing_target_returns_400(
        self, client, mock_db
    ):
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )
        resp = client.post(
            "/api/session/sess-123/action",
            json={"action": "switch_perspective"},
        )
        assert resp.status_code == 400
        assert "target_character" in resp.json()["detail"]
