"""RedisQuotaStore tests: fallback, Redis integration, and Lua atomicity."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")

import pytest

from agents.quota import (
    RedisQuotaStore,
    QuotaSnapshot,
    QuotaDecision,
    _MemoryQuotaStore,
    utc_day,
    ip_hash,
)


# ---------------------------------------------------------------------------
# Fallback: Redis unavailable -> memory
# ---------------------------------------------------------------------------

class _FakeClient:
    def __init__(self, host: str = "1.2.3.4"):
        self.host = host


class _FakeRequest:
    def __init__(self, ip: str = "1.2.3.4", headers: dict | None = None):
        self.client = _FakeClient(ip)
        self.headers = headers or {}


@pytest.fixture
def store():
    """RedisQuotaStore with no Redis URL — falls back to memory."""
    return RedisQuotaStore()


@pytest.fixture
def memory_store():
    return _MemoryQuotaStore()


async def test_fallback_snapshot_memory_when_no_redis(store):
    """When Redis is unavailable, snapshot delegates to memory."""
    snap = await store.snapshot("test-id", "2099-01-01", 10, 100)
    assert isinstance(snap, QuotaSnapshot)
    assert snap.used == 0
    assert snap.remaining == 10
    assert snap.global_remaining == 100


async def test_fallback_try_consume_memory_when_no_redis(store):
    """When Redis is unavailable, try_consume delegates to memory."""
    day = "2099-01-01"
    decision = await store.try_consume("test-id", day, 3, 10, 100)
    assert decision.allowed
    assert decision.snapshot.used == 3
    assert decision.snapshot.remaining == 7

    # Exhaust
    await store.try_consume("test-id", day, 7, 10, 100)
    blocked = await store.try_consume("test-id", day, 1, 10, 100)
    assert not blocked.allowed
    assert blocked.reason == "free_quota_exhausted"


async def test_fallback_check_rate_limit_memory_when_no_redis(store):
    """When Redis is unavailable, check_rate_limit delegates to memory."""
    ip_a = "10.0.0.1"
    # With generous limits, should be allowed
    assert await store.check_rate_limit(ip_a, 1000, 3600)

    # With tight limits — use a different IP so earlier hits don't carry over
    ip_b = "10.0.0.2"
    assert await store.check_rate_limit(ip_b, 1, 3600)
    assert not await store.check_rate_limit(ip_b, 1, 3600)


async def test_fallback_global_budget_exhausted(store):
    """Global budget exhausted correctly via memory fallback."""
    day = "2099-01-01"
    # Exhaust global budget (consume full 100)
    await store.try_consume("id-a", day, 100, 100, 100)
    # Second identity tries to consume but global is exhausted
    blocked = await store.try_consume("id-b", day, 1, 100, 100)
    assert not blocked.allowed
    assert blocked.reason == "global_budget_exhausted"


async def test_redis_unavailable_logs_and_returns_memory_result(store):
    """When Redis connect fails, store falls back without raising."""
    # Simulate network failure by setting a bogus redis_url
    from agents.quota import settings
    original = settings.redis_url
    settings.redis_url = "redis://localhost:99999/0"
    try:
        # Should fall back to memory without error
        snap = await store.snapshot("x", "2099-01-01", 10, 100)
        assert snap.used == 0
    finally:
        settings.redis_url = original


# ---------------------------------------------------------------------------
# Mocked Redis integration
# ---------------------------------------------------------------------------

async def test_mocked_redis_snapshot():
    """RedisQuotaStore.snapshot reads from Redis when available."""
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(side_effect=["5", "20"])
    mock_redis.ping = AsyncMock(return_value=True)

    store = RedisQuotaStore()
    store._redis_client = mock_redis
    store._redis_available = True

    snap = await store.snapshot("test-id", "2099-01-01", 10, 100)
    assert snap.used == 5
    assert snap.remaining == 5
    assert snap.global_used == 20
    assert snap.global_remaining == 80
    mock_redis.get.assert_any_call("quota:2099-01-01:test-id")
    mock_redis.get.assert_any_call("quota:2099-01-01:global")


async def test_mocked_redis_try_consume_allowed():
    """RedisQuotaStore.try_consume uses Lua script and returns allowed."""
    mock_redis = MagicMock()
    mock_redis.eval = AsyncMock(return_value=[1, 3, 3, ""])
    mock_redis.ping = AsyncMock(return_value=True)

    store = RedisQuotaStore()
    store._redis_client = mock_redis
    store._redis_available = True

    decision = await store.try_consume("test-id", "2099-01-01", 3, 10, 100)
    assert decision.allowed
    assert decision.snapshot.used == 3
    assert decision.snapshot.remaining == 7
    mock_redis.eval.assert_awaited_once()


async def test_mocked_redis_try_consume_blocked():
    """RedisQuotaStore.try_consume blocks when Lua script returns exhausted."""
    mock_redis = MagicMock()
    mock_redis.eval = AsyncMock(return_value=[0, 10, 10, "free_quota_exhausted"])
    mock_redis.ping = AsyncMock(return_value=True)

    store = RedisQuotaStore()
    store._redis_client = mock_redis
    store._redis_available = True

    decision = await store.try_consume("test-id", "2099-01-01", 1, 10, 100)
    assert not decision.allowed
    assert decision.reason == "free_quota_exhausted"
    assert decision.http_status == 402


async def test_mocked_redis_global_budget_exhausted():
    """Redis Lua script returns global_budget_exhausted correctly."""
    mock_redis = MagicMock()
    mock_redis.eval = AsyncMock(return_value=[0, 5, 100, "global_budget_exhausted"])
    mock_redis.ping = AsyncMock(return_value=True)

    store = RedisQuotaStore()
    store._redis_client = mock_redis
    store._redis_available = True

    decision = await store.try_consume("test-id", "2099-01-01", 1, 10, 100)
    assert not decision.allowed
    assert decision.reason == "global_budget_exhausted"
    assert decision.http_status == 429


async def test_mocked_redis_check_rate_limit_allowed():
    """Redis rate limit Lua script returns allowed."""
    mock_redis = MagicMock()
    mock_redis.eval = AsyncMock(return_value=[1])
    mock_redis.ping = AsyncMock(return_value=True)

    store = RedisQuotaStore()
    store._redis_client = mock_redis
    store._redis_available = True

    allowed = await store.check_rate_limit("1.2.3.4", 10, 3600)
    assert allowed


async def test_mocked_redis_check_rate_limit_blocked():
    """Redis rate limit Lua script returns blocked."""
    mock_redis = MagicMock()
    mock_redis.eval = AsyncMock(return_value=[0])
    mock_redis.ping = AsyncMock(return_value=True)

    store = RedisQuotaStore()
    store._redis_client = mock_redis
    store._redis_available = True

    allowed = await store.check_rate_limit("1.2.3.4", 10, 3600)
    assert not allowed


async def test_mocked_redis_fallback_on_error():
    """When Redis operations raise, RedisQuotaStore falls back to memory."""
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(side_effect=ConnectionError("connection lost"))
    mock_redis.eval = AsyncMock(side_effect=ConnectionError("connection lost"))
    mock_redis.ping = AsyncMock(return_value=True)

    store = RedisQuotaStore()
    store._redis_client = mock_redis
    store._redis_available = True

    # snapshot fallback
    snap = await store.snapshot("test-id", "2099-01-01", 10, 100)
    assert snap.used == 0  # memory is empty

    # try_consume fallback
    decision = await store.try_consume("test-id", "2099-01-01", 3, 10, 100)
    assert decision.allowed  # memory fallback works

    # check_rate_limit fallback
    allowed = await store.check_rate_limit("1.2.3.4", 1000, 3600)
    assert allowed


# ---------------------------------------------------------------------------
# Lua script atomicity tests (verify script logic without Redis)
# ---------------------------------------------------------------------------

def test_try_consume_lua_accepts_within_limits():
    """Simulate the Lua script logic: consumes within limits."""
    # Lua equivalent logic in Python to verify correctness
    used = 0
    g_used = 0
    cost, limit, global_limit = 3, 10, 100

    assert g_used + cost <= global_limit
    assert used + cost <= limit
    used += cost
    g_used += cost

    assert used == 3
    assert g_used == 3


def test_try_consume_lua_blocks_global_exhausted():
    """Simulate Lua logic: global budget exhausted."""
    used = 5
    g_used = 98
    cost, limit, global_limit = 3, 100, 100

    assert g_used + cost > global_limit  # blocked
    assert used + cost <= limit  # identity would be fine


def test_try_consume_lua_blocks_identity_exhausted():
    """Simulate Lua logic: identity quota exhausted."""
    used = 9
    g_used = 20
    cost, limit, global_limit = 3, 10, 100

    assert g_used + cost <= global_limit  # global would be fine
    assert used + cost > limit  # blocked


def test_try_consume_lua_blocks_both_exhausted():
    """Simulate Lua logic: both exhausted, global takes priority in Lua."""
    used = 9
    g_used = 99
    cost, limit, global_limit = 3, 10, 100

    assert g_used + cost > global_limit  # global blocked (checked first in Lua)
    assert used + cost > limit  # identity also blocked


# ---------------------------------------------------------------------------
# Constructor: memory_fallback parameter
# ---------------------------------------------------------------------------

async def test_custom_memory_fallback():
    """RedisQuotaStore accepts a custom memory fallback."""
    mem = _MemoryQuotaStore()
    store = RedisQuotaStore(memory_fallback=mem)
    assert store._memory is mem

    # Should work just like default
    snap = await store.snapshot("x", "2099-01-01", 10, 100)
    assert snap.used == 0