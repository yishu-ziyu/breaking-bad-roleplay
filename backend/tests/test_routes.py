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
from types import SimpleNamespace
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


# ---------------------------------------------------------------------------
# GET /api/session/{id}/messages  (Cycle 44 — H2/H3 fixes)
# ---------------------------------------------------------------------------


def _messages_result(messages):
    """Build a mock SQLAlchemy Result whose ``scalars().all()`` returns
    ``messages`` (a list of Message-like objects)."""
    result = MagicMock()
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=messages)
    result.scalars = MagicMock(return_value=scalars)
    return result


def _make_message_row(
    msg_id: str = "msg-1",
    session_id: str = "sess-123",
    role: str = "assistant",
    content: str = "Walt enters the RV.",
    character_name: str | None = "Walter White",
    emotion_state: str | None = "tense",
    gif_search_query: str | None = None,
    beat_id: str | None = "beat-1",
    created_at: datetime | None = None,
):
    """Build a lightweight Message row matching the MessageOut schema.

    Uses SimpleNamespace for clean attribute access during FastAPI
    response serialization (same access pattern as real ORM rows).
    """
    if created_at is None:
        created_at = datetime(2025, 1, 1, 12, 0, 0)
    return SimpleNamespace(
        id=msg_id,
        session_id=session_id,
        role=role,
        content=content,
        character_name=character_name,
        emotion_state=emotion_state,
        gif_search_query=gif_search_query,
        beat_id=beat_id,
        created_at=created_at,
    )


class TestListSessionMessages:
    """Cycle 44 — H2 (limit/offset) + H3 (select id) coverage.

    The route issues two db.execute calls:
      1. Existence check: select(SessionModel.id) — returns session id or None
      2. Message query: select(MessageModel)...limit().offset() — returns rows

    Tests use ``side_effect=[existence_result, messages_result]`` so each
    call gets the right mock result. Statement-level limit/offset is
    verified by inspecting the Select object passed to the second call.
    """

    def test_default_limit_returns_messages(self, client, mock_db):
        """(a) Default call returns messages and applies limit=500."""
        existence = _scalar_result("sess-123")
        msgs = [
            _make_message_row(msg_id="m1", content="first"),
            _make_message_row(msg_id="m2", content="second"),
        ]
        messages_result = _messages_result(msgs)
        mock_db.execute = AsyncMock(
            side_effect=[existence, messages_result]
        )

        resp = client.get("/api/session/sess-123/messages")

        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        assert body[0]["id"] == "m1"
        assert body[0]["content"] == "first"
        assert body[1]["id"] == "m2"
        # Two execute calls: existence check + message query.
        assert mock_db.execute.await_count == 2
        # The message query (second call) must carry limit=500 (default).
        msg_stmt = mock_db.execute.call_args_list[1][0][0]
        assert getattr(msg_stmt, "_limit", None) == 500

    def test_custom_limit_respected(self, client, mock_db):
        """(b) ?limit=N applies N to the message query."""
        existence = _scalar_result("sess-123")
        messages_result = _messages_result([])
        mock_db.execute = AsyncMock(
            side_effect=[existence, messages_result]
        )

        resp = client.get("/api/session/sess-123/messages?limit=5")

        assert resp.status_code == 200
        msg_stmt = mock_db.execute.call_args_list[1][0][0]
        assert getattr(msg_stmt, "_limit", None) == 5

    def test_limit_capped_at_500(self, client, mock_db):
        """?limit=10000 is capped to 500 server-side (H2 constraint)."""
        existence = _scalar_result("sess-123")
        messages_result = _messages_result([])
        mock_db.execute = AsyncMock(
            side_effect=[existence, messages_result]
        )

        resp = client.get("/api/session/sess-123/messages?limit=10000")

        assert resp.status_code == 200
        msg_stmt = mock_db.execute.call_args_list[1][0][0]
        assert getattr(msg_stmt, "_limit", None) == 500

    def test_offset_respected(self, client, mock_db):
        """(c) ?offset=N applies N to the message query."""
        existence = _scalar_result("sess-123")
        messages_result = _messages_result([])
        mock_db.execute = AsyncMock(
            side_effect=[existence, messages_result]
        )

        resp = client.get("/api/session/sess-123/messages?offset=10")

        assert resp.status_code == 200
        msg_stmt = mock_db.execute.call_args_list[1][0][0]
        assert getattr(msg_stmt, "_offset", None) == 10

    def test_unknown_session_returns_404(self, client, mock_db):
        """(d) Non-existent session returns 404, no message query issued."""
        mock_db.execute = AsyncMock(return_value=_scalar_result(None))

        resp = client.get("/api/session/does-not-exist/messages")

        assert resp.status_code == 404
        assert "Session not found" in resp.json()["detail"]
        # Only the existence check ran — message query must not fire.
        assert mock_db.execute.await_count == 1
