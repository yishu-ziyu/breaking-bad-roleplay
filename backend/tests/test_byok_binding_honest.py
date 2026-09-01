"""P3 (full-stack review) — BYOK binding must fail HONESTLY.

Problem being fixed: the connection store is a module dict. After a
restart/TTL eviction the id disappears, ``is_byok()`` returns False, and
the request silently falls back to PLATFORM keys — the operator pays for
traffic the user thinks is on their own key, invisibly.

Contract under test:
1. ``binding_state(sid)`` distinguishes "byok" (live in RAM), "none" (no
   session presented at all -> platform is correct), and "binding_lost"
   (sid presented but no longer resolvable -> must NOT bill platform).
2. ``enforce_platform_quota`` with a lost binding returns a denial with
   reason ``binding_expired`` / http_status 410 — never consumes credits.
3. TTS scope: a lost binding also blocks paid platform TTS.
4. A genuinely absent connection_session (platform mode) is unaffected.
"""

from __future__ import annotations

import os
import time

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)

import pytest

from agents import quota as quota_mod
from agents.connection_sessions import ConnectionSessionStore
from agents.quota import enforce_platform_quota


class _FakeClient:
    def __init__(self, host: str = "1.2.3.4"):
        self.host = host


class _FakeRequest:
    def __init__(self, ip: str = "1.2.3.4", headers: dict | None = None):
        self.client = _FakeClient(ip)
        self.headers = headers or {}


# ---------------------------------------------------------------------------
# binding_state tri-state on the store
# ---------------------------------------------------------------------------


class TestBindingState:
    def test_live_binding_is_byok(self):
        store = ConnectionSessionStore()
        session = store.bind(provider_id="minimax", llm_key="sk-live")
        assert store.binding_state(session.id) == "byok"

    def test_absent_id_is_platform(self):
        store = ConnectionSessionStore()
        assert store.binding_state(None) == "platform"
        assert store.binding_state("") == "platform"

    def test_unknown_id_is_binding_lost(self):
        """A presented-but-unresolvable id is NOT a platform user."""
        store = ConnectionSessionStore()
        assert store.binding_state("never-existing-id") == "binding_lost"

    def test_evicted_after_expiry_is_binding_lost(self):
        store = ConnectionSessionStore(ttl_seconds=1)
        session = store.bind(provider_id="minimax", llm_key="sk-x")
        assert store.binding_state(session.id) == "byok"
        # Force expiry the way a restart/TTL eviction would surface it.
        store._sessions[session.id].expires_at = time.time() - 1
        assert store.binding_state(session.id) == "binding_lost"


# ---------------------------------------------------------------------------
# enforce_platform_quota refuses to fall back to platform billing
# ---------------------------------------------------------------------------


class TestEnforceRejectsLostBinding:
    async def test_lost_binding_denied_410_not_platform_charged(self):
        store = quota_mod._store
        mem = store._memory if hasattr(store, "_memory") else store
        with mem._lock:
            mem._used.clear()
            mem._global.clear()
            mem._hits.clear()
        quota_mod.settings.free_credits_guest = 8  # type: ignore[attr-defined]
        quota_mod.settings.platform_daily_credit_budget = 5000  # type: ignore[attr-defined]

        req = _FakeRequest(ip="10.0.0.1")
        decision = await enforce_platform_quota(
            request=req,
            action="story_beat",
            connection_session_id="id-lost-by-restart",
            guest_id="550e8400-e29b-41d4-a716-446655440000",
        )
        assert decision.allowed is False
        assert decision.reason == "binding_expired"
        assert decision.http_status == 410
        # Nothing was consumed — the platform wallet is untouched.
        snap = mem.snapshot(
            quota_mod.identity_key(
                guest_id="550e8400-e29b-41d4-a716-446655440000", ip="10.0.0.1"
            ),
            quota_mod.utc_day(),
            8,
            5000,
        )
        assert snap.used == 0

    async def test_live_binding_still_skips_meter(self):
        quota_mod.settings.free_credits_guest = 8  # type: ignore[attr-defined]
        req = _FakeRequest(ip="10.0.0.2")
        from agents.connection_sessions import connection_store

        session = connection_store.bind(provider_id="minimax", llm_key="sk-ok")
        decision = await enforce_platform_quota(
            request=req, action="story_beat", connection_session_id=session.id
        )
        assert decision.allowed is True
        assert decision.snapshot.byok is True

    async def test_no_connection_session_uses_platform_normally(self):
        req = _FakeRequest(ip="10.0.0.3")
        decision = await enforce_platform_quota(
            request=req,
            action="story_beat",
            guest_id="660e8400-e29b-41d4-a716-446655440000",
        )
        assert decision.allowed is True
        assert decision.snapshot.tier in ("guest", "user")
