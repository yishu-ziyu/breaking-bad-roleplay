"""Platform free-tier quota + rate-limit tests."""

from __future__ import annotations

import os

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")

from agents import quota as quota_mod
from agents.quota import (
    COST_CHAT_DIRECT,
    COST_STORY_BEAT,
    action_cost,
    enforce_platform_quota,
    identity_key,
    normalize_guest_id,
    read_quota_snapshot,
)


class _FakeClient:
    def __init__(self, host: str = "1.2.3.4"):
        self.host = host


class _FakeRequest:
    def __init__(self, ip: str = "1.2.3.4", headers: dict | None = None):
        self.client = _FakeClient(ip)
        self.headers = headers or {}


def setup_function(_fn=None):
    # Reset memory store between tests
    store = quota_mod._store
    with store._lock:
        store._used.clear()
        store._global.clear()
        store._hits.clear()


def test_normalize_guest_id_accepts_uuid_only():
    assert normalize_guest_id("not-a-uuid") is None
    assert normalize_guest_id("550e8400-e29b-41d4-a716-446655440000") == "550e8400-e29b-41d4-a716-446655440000"


def test_action_costs():
    assert action_cost("chat", mode="direct") == COST_CHAT_DIRECT
    assert action_cost("chat", mode="crew") == 2
    assert action_cost("story_beat") == COST_STORY_BEAT
    assert action_cost("tts") == 1


def test_identity_scopes_guest_by_ip():
    a = identity_key(guest_id="550e8400-e29b-41d4-a716-446655440000", ip="1.1.1.1")
    b = identity_key(guest_id="550e8400-e29b-41d4-a716-446655440000", ip="2.2.2.2")
    assert a != b
    assert a.startswith("g:")


def test_free_quota_exhausts_after_limit():
    # Override autouse generous limits for this unit test.
    quota_mod.settings.free_credits_guest = 8  # type: ignore[attr-defined]
    quota_mod.settings.platform_daily_credit_budget = 5000  # type: ignore[attr-defined]
    req = _FakeRequest(ip="10.0.0.9")
    guest = "550e8400-e29b-41d4-a716-446655440000"
    # Default guest limit 8; burn with story beats (5 each) then chat
    d1 = enforce_platform_quota(request=req, action="story_beat", guest_id=guest)
    assert d1.allowed and d1.snapshot.remaining == 3
    assert d1.snapshot.tier == "guest"
    d2 = enforce_platform_quota(request=req, action="chat", mode="direct", guest_id=guest)
    assert d2.allowed and d2.snapshot.remaining == 2
    d3 = enforce_platform_quota(request=req, action="chat", mode="crew", guest_id=guest)
    assert d3.allowed and d3.snapshot.remaining == 0
    d4 = enforce_platform_quota(request=req, action="chat", mode="direct", guest_id=guest)
    assert not d4.allowed
    assert d4.reason == "free_quota_exhausted"
    assert d4.http_status == 402


def test_logged_in_user_gets_higher_daily_limit(monkeypatch):
    quota_mod.settings.free_credits_guest = 8  # type: ignore[attr-defined]
    quota_mod.settings.free_credits_user = 80  # type: ignore[attr-defined]
    quota_mod.settings.platform_daily_credit_budget = 5000  # type: ignore[attr-defined]

    class _Auth:
        user_id = "user-aaa-111"
        email = "friend@example.com"

    monkeypatch.setattr(
        "agents.auth_user.resolve_auth_user",
        lambda *_a, **_k: _Auth(),
    )
    req = _FakeRequest(ip="10.0.0.10", headers={"Authorization": "Bearer fake-jwt"})
    guest = "550e8400-e29b-41d4-a716-446655440010"
    # 80 credits: 16 story beats * 5 = 80
    for i in range(16):
        d = enforce_platform_quota(request=req, action="story_beat", guest_id=guest)
        assert d.allowed, f"beat {i} should pass under user tier"
        assert d.snapshot.tier == "user"
        assert d.snapshot.limit == 80
    blocked = enforce_platform_quota(request=req, action="story_beat", guest_id=guest)
    assert not blocked.allowed
    assert blocked.reason == "free_quota_exhausted"


def test_user_identity_is_per_account_not_shared_ip(monkeypatch):
    quota_mod.settings.free_credits_user = 80  # type: ignore[attr-defined]
    quota_mod.settings.platform_daily_credit_budget = 5000  # type: ignore[attr-defined]

    users = iter(["user-a", "user-b"])

    class _Auth:
        def __init__(self, uid: str):
            self.user_id = uid
            self.email = None

    monkeypatch.setattr(
        "agents.auth_user.resolve_auth_user",
        lambda *_a, **_k: _Auth(next(users)),
    )
    # Same IP, two different logins -> independent pools
    req = _FakeRequest(ip="10.0.0.11")
    d1 = enforce_platform_quota(request=req, action="story_beat", guest_id=None)
    assert d1.allowed and d1.snapshot.remaining == 75
    # Reset iterator by rebinding for second call
    monkeypatch.setattr(
        "agents.auth_user.resolve_auth_user",
        lambda *_a, **_k: _Auth("user-b"),
    )
    d2 = enforce_platform_quota(request=req, action="story_beat", guest_id=None)
    assert d2.allowed and d2.snapshot.remaining == 75
    assert d1.snapshot.identity != d2.snapshot.identity

def test_byok_skips_quota(monkeypatch):
    class _Sess:
        pass

    monkeypatch.setattr(
        "agents.connection_sessions.connection_store.get",
        lambda _sid: _Sess(),
    )
    req = _FakeRequest()
    for _ in range(20):
        d = enforce_platform_quota(
            request=req,
            action="story_beat",
            connection_session_id="bind-token",
        )
        assert d.allowed
        assert d.snapshot.byok is True


def test_rate_limit_blocks_burst():
    # Tiny limit for test (autouse sets a high default)
    quota_mod.settings.platform_rate_limit_per_hour = 3  # type: ignore[attr-defined]
    quota_mod.settings.free_credits_guest = 100  # type: ignore[attr-defined]
    req = _FakeRequest(ip="9.9.9.9")
    guest = "550e8400-e29b-41d4-a716-446655440099"
    assert enforce_platform_quota(request=req, action="tts", guest_id=guest).allowed
    assert enforce_platform_quota(request=req, action="tts", guest_id=guest).allowed
    assert enforce_platform_quota(request=req, action="tts", guest_id=guest).allowed
    blocked = enforce_platform_quota(request=req, action="tts", guest_id=guest)
    assert not blocked.allowed
    assert blocked.reason == "rate_limited"
    assert blocked.http_status == 429


def test_read_snapshot_does_not_consume():
    req = _FakeRequest(ip="8.8.8.8")
    guest = "550e8400-e29b-41d4-a716-446655440088"
    before = read_quota_snapshot(request=req, guest_id=guest)
    assert before.used == 0
    after = read_quota_snapshot(request=req, guest_id=guest)
    assert after.used == 0
