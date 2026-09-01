"""P2 (full-stack review) — quota refund for undelivered story beats.

Problem being fixed: the SSE stream route charges ``story_beat`` (5 credits)
BEFORE generation. When the stream dies mid-beat (proxy cut, LLM error,
client abort) the player paid 5 credits AND lost the beat; the watchdog
reconnect then charges another 5 for the SAME logical attempt.

Contract under test:
1. ``_MemoryQuotaStore.refund`` gives credits back (identity + global),
   clamped at zero.
2. ``RedisQuotaStore.refund`` mirrors it (falls back to memory when Redis
   is absent, which is the test environment).
3. ``enforce_platform_quota`` records the charged ``cost`` on the returned
   snapshot so the caller can refund exactly what was billed.
4. ``refund_platform_quota`` is a no-op for BYOK / zero-cost snapshots.
"""

from __future__ import annotations

import os
from dataclasses import replace

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")

import pytest

from agents import quota as quota_mod
from agents.quota import (
    COST_STORY_BEAT,
    enforce_platform_quota,
    refund_platform_quota,
)


class _FakeClient:
    def __init__(self, host: str = "1.2.3.4"):
        self.host = host


class _FakeRequest:
    def __init__(self, ip: str = "1.2.3.4", headers: dict | None = None):
        self.client = _FakeClient(ip)
        self.headers = headers or {}


def _mem_store():
    store = quota_mod._store
    return store._memory if hasattr(store, "_memory") else store


def setup_function(_fn=None):
    mem = _mem_store()
    with mem._lock:
        mem._used.clear()
        mem._global.clear()
        mem._hits.clear()


# ---------------------------------------------------------------------------
# Store level
# ---------------------------------------------------------------------------


class TestMemoryRefund:
    def test_refund_decrements_identity_and_global(self):
        mem = _mem_store()
        day = quota_mod.utc_day()
        decision = mem.try_consume("g:test", day, 5, 8, 5000)
        assert decision.allowed
        assert decision.snapshot.used == 5
        assert decision.snapshot.global_used == 5

        snap = mem.refund("g:test", day, 5, 8, 5000)
        assert snap.used == 0
        assert snap.remaining == 8
        assert snap.global_used == 0
        assert snap.global_remaining == 5000

    def test_refund_clamps_at_zero(self):
        mem = _mem_store()
        day = quota_mod.utc_day()
        mem.try_consume("g:test", day, 5, 8, 5000)
        snap = mem.refund("g:test", day, 100, 8, 5000)  # over-refund must not go negative
        assert snap.used == 0
        assert snap.global_used == 0

    def test_refund_only_touches_the_identity_refunded(self):
        mem = _mem_store()
        day = quota_mod.utc_day()
        mem.try_consume("g:a", day, 5, 8, 5000)
        mem.try_consume("g:b", day, 5, 8, 5000)
        snap_a = mem.snapshot("g:a", day, 8, 5000)
        snap_b = mem.snapshot("g:b", day, 8, 5000)
        assert snap_a.used == 5 and snap_b.used == 5
        mem.refund("g:a", day, 5, 8, 5000)
        assert mem.snapshot("g:b", day, 8, 5000).used == 5


class TestRedisStoreRefundFallback:
    async def test_refund_falls_back_to_memory_without_redis(self):
        """In tests there is no REDIS_URL, so RedisQuotaStore.refund must
        delegate to the memory store — the same contract as try_consume."""
        store = quota_mod._store
        day = quota_mod.utc_day()
        decision = await store.try_consume("g:refund-fb", day, 5, 8, 5000)
        assert decision.allowed
        snap = await store.refund("g:refund-fb", day, 5, 8, 5000)
        assert snap.used == 0


# ---------------------------------------------------------------------------
# enforce / refund module API
# ---------------------------------------------------------------------------


class TestEnforceRecordsCost:
    async def test_allowed_story_beat_snapshot_carries_cost(self):
        quota_mod.settings.free_credits_guest = 8  # type: ignore[attr-defined]
        quota_mod.settings.platform_daily_credit_budget = 5000  # type: ignore[attr-defined]
        req = _FakeRequest(ip="10.0.1.5")
        decision = await enforce_platform_quota(
            request=req,
            action="story_beat",
            guest_id="550e8400-e29b-41d4-a716-446655440000",
        )
        assert decision.allowed
        assert decision.snapshot.cost == COST_STORY_BEAT

    async def test_zero_cost_action_snapshot_records_zero(self):
        req = _FakeRequest(ip="10.0.1.6")
        decision = await enforce_platform_quota(request=req, action="session_create")
        assert decision.allowed
        assert decision.snapshot.cost == 0


class TestRefundPlatformQuota:
    async def test_refunds_charged_snapshot(self):
        quota_mod.settings.free_credits_guest = 8  # type: ignore[attr-defined]
        quota_mod.settings.platform_daily_credit_budget = 5000  # type: ignore[attr-defined]
        req = _FakeRequest(ip="10.0.2.5")
        decision = await enforce_platform_quota(
            request=req,
            action="story_beat",
            guest_id="550e8400-e29b-41d4-a716-446655440000",
        )
        assert decision.snapshot.used == COST_STORY_BEAT
        done = await refund_platform_quota(decision.snapshot)
        assert done is True
        snap = await quota_mod._store.snapshot(
            decision.snapshot.identity,
            decision.snapshot.day,
            decision.snapshot.limit,
            decision.snapshot.global_limit,
        )
        assert snap.used == 0

    async def test_byok_and_zero_cost_are_noops(self):
        assert await refund_platform_quota(None) is False
        byok = quota_mod.byok_snapshot()
        assert await refund_platform_quota(byok) is False
        zero = replace(byok, identity="g:x", cost=0)
        assert await refund_platform_quota(zero) is False
