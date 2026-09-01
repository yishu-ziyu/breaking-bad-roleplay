"""P2 (full-stack review) — route-level story_beat refund on undelivered stream.

The stream route bills ``story_beat`` upfront. If the SSE generator ends
WITHOUT ever handing a ``beat_ready``/``complete`` payload to the transport
(LLM error, client abort, stop-before-delivery), the same request that was
charged must trigger exactly one refund of that charge.

Reconnect economics: request A (bill 5, dies, refund 5, rewind to beat N)
then reconnect request B (bill 5, delivers beat N) -> player spends 5 for
one beat and sees that beat.
"""

from __future__ import annotations

import asyncio
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
from api.routes import get_db, get_director  # noqa: E402
from main import app  # noqa: E402
from models.schemas import AgentEvent  # noqa: E402


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    return result


def _make_session_row():
    session = MagicMock()
    session.id = "sess-rf-1"
    session.status = "active"
    session.task_prompt = "Cook a batch in the RV"
    return session


def _billed_snapshot(cost: int = 5):
    snap = MagicMock()
    snap.cost = cost
    return snap


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.execute = AsyncMock()
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


async def _drain(resp: httpx.Response) -> str:
    chunks: list[str] = []
    async for chunk in resp.aiter_text():
        chunks.append(chunk)
    return "".join(chunks)


async def _flush_scheduled_tasks():
    """Let fire-and-forget refund tasks run."""
    for _ in range(5):
        await asyncio.sleep(0)


class TestStreamRefund:
    async def test_mid_stream_failure_refunds_story_beat(
        self, client, mock_db, mock_director
    ):
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )

        async def dying_beat(*args, **kwargs) -> AsyncIterator[AgentEvent]:
            yield AgentEvent(type="status", data={"message": "thinking"})
            raise RuntimeError("provider exploded")

        mock_director.process_next_beat = dying_beat

        refund = AsyncMock(return_value=True)
        with patch(
            "api.routes.enforce_platform_quota",
            new=AsyncMock(
                return_value=MagicMock(
                    allowed=True, snapshot=_billed_snapshot(5), http_status=200
                )
            ),
        ), patch("api.routes.refund_platform_quota", refund):
            async with client.stream(
                "GET", "/api/session/sess-rf-1/stream"
            ) as resp:
                body = await _drain(resp)
            await _flush_scheduled_tasks()

        assert "event: error" in body  # player sees a clean error event
        refund.assert_awaited_once()
        passed_snap = refund.await_args.args[0]
        assert passed_snap.cost == 5

    async def test_delivered_beat_is_not_refunded(
        self, client, mock_db, mock_director
    ):
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )

        async def happy_beat(*args, **kwargs) -> AsyncIterator[AgentEvent]:
            yield AgentEvent(
                type="beat_ready",
                data={"beat_id": "beat_1", "beat_summary": "RV"},
            )

        mock_director.process_next_beat = happy_beat

        refund = AsyncMock(return_value=True)
        with patch(
            "api.routes.enforce_platform_quota",
            new=AsyncMock(
                return_value=MagicMock(
                    allowed=True, snapshot=_billed_snapshot(5), http_status=200
                )
            ),
        ), patch("api.routes.refund_platform_quota", refund):
            async with client.stream(
                "GET", "/api/session/sess-rf-1/stream"
            ) as resp:
                body = await _drain(resp)
            await _flush_scheduled_tasks()

        assert "event: beat_ready" in body
        refund.assert_not_awaited()

    async def test_byok_zero_cost_stream_never_refunds(
        self, client, mock_db, mock_director
    ):
        """BYOK requests carry cost 0 (no platform charge) — nothing to
        refund even when the stream fails."""
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )

        async def dying_beat(*args, **kwargs) -> AsyncIterator[AgentEvent]:
            raise RuntimeError("provider exploded before any event")
            yield  # pragma: no cover

        mock_director.process_next_beat = dying_beat

        refund = AsyncMock(return_value=True)
        with patch(
            "api.routes.enforce_platform_quota",
            new=AsyncMock(
                return_value=MagicMock(
                    allowed=True, snapshot=_billed_snapshot(0), http_status=200
                )
            ),
        ), patch("api.routes.refund_platform_quota", refund):
            async with client.stream(
                "GET", "/api/session/sess-rf-1/stream"
            ) as resp:
                body = await _drain(resp)
            await _flush_scheduled_tasks()

        assert "event: error" in body
        refund.assert_not_awaited()
