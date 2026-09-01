"""P1 (full-stack review) — SSE heartbeat keep-alive tests.

Problem being fixed: ``GET /api/session/{id}/stream`` can stay silent for
the entire beat-plan LLM call (up to the 120s provider read timeout).
With an idle-gap-sensitive proxy in front (nginx default
``proxy_read_timeout`` is 60s), the stream is cut mid-beat, the frontend
watchdog fires, and the silent reconnect re-bills the player.

Fix contract under test:
1. While the Director is silent, the route emits an SSE *comment* frame
   (``: ping``) at most ``SSE_HEARTBEAT_INTERVAL_SECONDS`` apart.
2. Comment frames carry no ``event:``/``data:`` lines — existing clients
   (sseFetch.parseSseChunk) must keep parsing real events unchanged.
3. A ping must NOT trigger the per-event stop-signal DB check (no extra
   ``session.execute``), otherwise a silent stream would hammer the pool.
4. A flowing generator emits no pings at all.
5. When the generator finishes, the wrapper finishes (no leaked task).
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

import api.routes as routes  # noqa: E402
from api.routes import _iter_with_heartbeat, get_db, get_director  # noqa: E402
from main import app  # noqa: E402
from models.schemas import AgentEvent  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures (mirror test_sse_stream.py — stream endpoint sources its DB
# sessions from api.routes.async_session_factory, Cycle 45 / H1)
# ---------------------------------------------------------------------------


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    return result


def _make_session_row(
    session_id: str = "sess-hb-1",
    status: str = "active",
    task_prompt: str = "Cook a batch in the RV",
):
    session = MagicMock()
    session.id = session_id
    session.status = status
    session.task_prompt = task_prompt
    return session


async def _read_stream(resp: httpx.Response) -> str:
    chunks: list[str] = []
    async for chunk in resp.aiter_text():
        chunks.append(chunk)
    return "".join(chunks)


def _beat_ready_event() -> AgentEvent:
    return AgentEvent(
        type="beat_ready",
        data={"beat_id": "beat_1", "beat_summary": "RV in the desert"},
    )


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.execute = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    return db


@pytest.fixture
def mock_director():
    return MagicMock()


@pytest.fixture
def mock_session_factory(mock_db):
    class _SessionCM:
        async def __aenter__(self):
            return mock_db

        async def __aexit__(self, *exc_info):
            return False

    return lambda: _SessionCM()


@pytest.fixture
async def client(mock_db, mock_director, mock_session_factory):
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_director] = lambda: mock_director
    try:
        with patch("api.routes.async_session_factory", mock_session_factory):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as c:
                yield c
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def fast_heartbeat(monkeypatch):
    """Shrink the heartbeat interval so tests run in milliseconds."""
    monkeypatch.setattr(routes, "SSE_HEARTBEAT_INTERVAL_SECONDS", 0.05)


# ---------------------------------------------------------------------------
# Route-level tests
# ---------------------------------------------------------------------------


class TestStreamHeartbeat:
    async def test_ping_emitted_during_director_silence(
        self, client, mock_db, mock_director, fast_heartbeat
    ):
        """A director that is silent for ~5 heartbeat intervals must emit
        ``: ping`` comment frames before the eventual event."""
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )

        async def slow_beat(*args, **kwargs) -> AsyncIterator[AgentEvent]:
            await asyncio.sleep(0.3)
            yield _beat_ready_event()

        mock_director.process_next_beat = slow_beat

        async with client.stream("GET", "/api/session/sess-hb-1/stream") as resp:
            assert resp.status_code == 200
            body = await _read_stream(resp)

        assert ": ping" in body, (
            "expected at least one heartbeat comment frame during silence"
        )
        ping_idx = body.index(": ping")
        event_idx = body.index("event: beat_ready")
        assert ping_idx < event_idx, "heartbeat must arrive before the beat"
        # The ping frame itself must not masquerade as an event.
        ping_frame = body[ping_idx:event_idx]
        for line in ping_frame.split("\n\n"):
            stripped = line.strip()
            if stripped.startswith(": "):
                assert "event:" not in stripped and "data:" not in stripped

    async def test_ping_does_not_trigger_stop_signal_db_check(
        self, client, mock_db, mock_director, fast_heartbeat
    ):
        """Per-event stop-signal checks stay per-event: existence check +
        one status check per real event, regardless of how many pings were
        emitted in between."""
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )

        async def slow_beat(*args, **kwargs) -> AsyncIterator[AgentEvent]:
            await asyncio.sleep(0.3)  # ~5+ pings at 0.05s interval
            yield _beat_ready_event()

        mock_director.process_next_beat = slow_beat

        async with client.stream("GET", "/api/session/sess-hb-1/stream") as resp:
            body = await _read_stream(resp)

        assert body.count(": ping") >= 3
        # 1 existence check + 1 stop-signal check for the single event.
        assert mock_db.execute.await_count == 2, (
            f"expected exactly 2 DB executes, got {mock_db.execute.await_count}"
        )

    async def test_no_ping_while_events_flow(
        self, client, mock_db, mock_director, fast_heartbeat
    ):
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )

        async def fast_beat(*args, **kwargs) -> AsyncIterator[AgentEvent]:
            for i in range(5):
                yield AgentEvent(type="status", data={"message": f"tick {i}"})

        mock_director.process_next_beat = fast_beat

        async with client.stream("GET", "/api/session/sess-hb-1/stream") as resp:
            body = await _read_stream(resp)

        assert ": ping" not in body
        assert body.count("event: status") == 5


# ---------------------------------------------------------------------------
# Helper-level tests for _iter_with_heartbeat
# ---------------------------------------------------------------------------


class TestIterWithHeartbeat:
    async def test_yields_none_on_timeout_then_events(self):
        async def slow() -> AsyncIterator[AgentEvent]:
            await asyncio.sleep(0.15)
            yield _beat_ready_event()

        items: list[AgentEvent | None] = []
        async for item in _iter_with_heartbeat(slow(), interval=0.03):
            items.append(item)

        assert items[-1] is not None
        assert items[-1].type == "beat_ready"
        assert any(item is None for item in items[:-1])

    async def test_immediate_completion_yields_no_pings(self):
        async def fast() -> AsyncIterator[AgentEvent]:
            yield _beat_ready_event()

        items = [item async for item in _iter_with_heartbeat(fast(), interval=1.0)]
        assert len(items) == 1
        assert items[0].type == "beat_ready"

    async def test_exception_propagates(self):
        async def boom() -> AsyncIterator[AgentEvent]:
            yield _beat_ready_event()
            raise RuntimeError("provider exploded")

        with pytest.raises(RuntimeError):
            async for _ in _iter_with_heartbeat(boom(), interval=1.0):
                pass
