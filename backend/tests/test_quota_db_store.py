"""P3 (full-stack review) — Postgres-backed quota store.

Problem being fixed: with REDIS_URL unset the quota counters live in an
in-process dict — every deploy resets the guest's 8 credits (infinitely
farmable) and every worker keeps its own copy. The DB tier makes the
meter survive restarts and be coherent across workers without new infra.

Uses aiosqlite so the ON CONFLICT / CASE SQL is exercised for real.
"""

from __future__ import annotations

import os

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from db.models import Base


@pytest.fixture
async def session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


def _store(factory):
    from agents.quota import _DbQuotaStore

    return _DbQuotaStore(factory)


class TestDbQuotaStore:
    async def test_consume_then_refund(self, session_factory):
        store = _store(session_factory)
        day, ident = "2099-01-01", "g:alpha"
        d = await store.try_consume(ident, day, 5, 8, 5000)
        assert d.allowed
        assert d.snapshot.used == 5
        assert d.snapshot.global_used == 5

        snap = await store.refund(ident, day, 5, 8, 5000)
        assert snap.used == 0
        assert snap.global_used == 0

    async def test_denial_at_identity_limit(self, session_factory):
        store = _store(session_factory)
        day, ident = "2099-01-02", "g:beta"
        for expected in (5,):
            d = await store.try_consume(ident, day, 5, 8, 5000)
            assert d.allowed
        d2 = await store.try_consume(ident, day, 5, 8, 5000)
        assert d2.allowed is False
        assert d2.reason == "free_quota_exhausted"
        assert d2.http_status == 402
        # Failed attempt must not have changed the counters.
        snap = await store.snapshot(ident, day, 8, 5000)
        assert snap.used == 5

    async def test_denial_at_global_budget(self, session_factory):
        store = _store(session_factory)
        day = "2099-01-03"
        d = await store.try_consume("g:gamma", day, 5, 8, 6)
        assert d.allowed
        d2 = await store.try_consume("g:delta", day, 5, 8, 6)
        assert d2.allowed is False
        assert d2.reason == "global_budget_exhausted"
        assert d2.http_status == 429

    async def test_survives_store_recreation(self, session_factory):
        """THE regression: a new process (new store object) sees old usage."""
        store_a = _store(session_factory)
        await store_a.try_consume("g:persist", "2099-01-04", 5, 8, 5000)
        store_b = _store(session_factory)  # "restart"
        snap = await store_b.snapshot("g:persist", "2099-01-04", 8, 5000)
        assert snap.used == 5

    async def test_refund_clamps_at_zero(self, session_factory):
        store = _store(session_factory)
        await store.try_consume("g:clamp", "2099-01-05", 5, 8, 5000)
        snap = await store.refund("g:clamp", "2099-01-05", 99, 8, 5000)
        assert snap.used == 0
        assert snap.global_used == 0
