"""P3 (full-stack review) — binding metadata audit row + single-worker guard.

Two remaining halves of the fix:
1. A successful bind writes a ``byok_connections`` row with METADATA ONLY
   (provider/model/base_url/region + key fingerprint hint). The raw API key
   must never touch the database — RAM stays the only key store.
2. The in-RAM key + the multi-worker invariant are connected: with Redis
   absent, running >1 worker splits the key map (worker A binds, worker B
   410s forever). Boot must refuse loudly instead of degrading silently.
"""

from __future__ import annotations

import os
from unittest.mock import patch

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from db.models import Base


@pytest.fixture
async def sqlite_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def client(sqlite_factory):
    from api.routes import get_db
    from main import app

    app.dependency_overrides[get_db] = lambda: None
    try:
        with patch("api.routes.async_session_factory", sqlite_factory):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as c:
                yield c
    finally:
        app.dependency_overrides.clear()


class TestBindPersistsMetadata:
    async def test_bind_writes_row_without_the_key(self, client, sqlite_factory):
        secret = "sk-super-secret-key-12345"
        resp = await client.post(
            "/api/connections/bind",
            json={"providerId": "deepseek", "modelId": "deepseek-chat", "llmKey": secret},
        )
        assert resp.status_code == 200
        body = resp.json()
        sid = body["connectionSessionId"]

        async with sqlite_factory() as db:
            rows = (
                await db.execute(
                    text("SELECT id, provider_id, model_id FROM byok_connections")
                )
            ).mappings().all()
        assert len(rows) == 1
        assert rows[0]["id"] == sid
        assert rows[0]["provider_id"] == "deepseek"
        assert rows[0]["model_id"] == "deepseek-chat"

        # No column anywhere may contain the raw key.
        async with sqlite_factory() as db:
            cols = (
                await db.execute(
                    text("SELECT * FROM byok_connections")
                )
            ).mappings().all()
        for row in cols:
            for value in dict(row).values():
                assert secret not in str(value)

    async def test_bind_db_failure_does_not_break_binding(self, client):
        """Persistence is best-effort: if the table is missing (dev without
        migration), bind must still succeed — availability over auditing."""
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def broken_factory():
            raise RuntimeError("no such table: byok_connections")
            yield None  # pragma: no cover

        with patch("api.routes.async_session_factory", broken_factory):
            resp = await client.post(
                "/api/connections/bind",
                json={"providerId": "deepseek", "llmKey": "sk-x"},
            )
        assert resp.status_code == 200
        assert resp.json()["connectionSessionId"]


class TestSingleWorkerGuard:
    def test_refuses_multiworker_without_redis(self, monkeypatch):
        import main as main_mod

        monkeypatch.setattr(main_mod.settings, "redis_url", "", raising=False)
        monkeypatch.setenv("WEB_CONCURRENCY", "4")
        with pytest.raises(RuntimeError) as exc:
            main_mod._enforce_runtime_invariants()
        assert "worker" in str(exc.value).lower()

    def test_allows_multiworker_with_redis(self, monkeypatch):
        import main as main_mod

        monkeypatch.setattr(main_mod.settings, "redis_url", "redis://x", raising=False)
        monkeypatch.setenv("WEB_CONCURRENCY", "4")
        main_mod._enforce_runtime_invariants()  # must not raise

    def test_allows_single_worker_without_redis(self, monkeypatch):
        import main as main_mod

        monkeypatch.setattr(main_mod.settings, "redis_url", "", raising=False)
        monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
        main_mod._enforce_runtime_invariants()  # today's deployment
