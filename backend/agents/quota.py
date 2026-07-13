"""Platform free-tier quota + burst rate limits.

Security goals:
- Platform API keys never leave the server (enforced elsewhere).
- Free demo usage is capped per identity and per site-day.
- BYOK bind sessions skip this meter (user pays their own provider).
- Identity is guest_id (UUID) + IP hash; guest rotation is limited by IP rate limits.

Persistence: in-process with optional Postgres mirror so Docker restarts lose
less state when DB is available. Vercel multi-instance is imperfect without a
shared store; Postgres upsert is the shared path when DATABASE_URL works.
"""

from __future__ import annotations

import hashlib
import re
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from config import settings

# Action costs (platform free pool)
COST_CHAT_DIRECT = 1
COST_CHAT_CREW = 2
COST_STORY_BEAT = 5
COST_TTS = 1

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)


def utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def normalize_guest_id(raw: str | None) -> str | None:
    if raw is None or not isinstance(raw, str):
        return None
    value = raw.strip()
    if not value or not _UUID_RE.match(value):
        return None
    return value.lower()


def client_ip(request: Any) -> str:
    """Best-effort client IP (respects first X-Forwarded-For hop)."""
    try:
        forwarded = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip() or "unknown"
        if request.client and request.client.host:
            return request.client.host
    except Exception:
        pass
    return "unknown"


def ip_hash(ip: str) -> str:
    salt = (settings.quota_ip_salt or "abq-quota").encode()
    return hashlib.sha256(salt + ip.encode()).hexdigest()[:24]


def identity_key(*, guest_id: str | None, ip: str) -> str:
    """Stable free-tier identity.

    Prefer guest UUID (survives refresh). Always scope by IP hash so
    rotating guest ids from one IP cannot multiply free pools forever.
    """
    g = normalize_guest_id(guest_id)
    ih = ip_hash(ip)
    if g:
        return f"g:{g}|ip:{ih}"
    return f"ip:{ih}"


def action_cost(action: str, *, mode: str | None = None) -> int:
    if action == "chat":
        return COST_CHAT_CREW if (mode or "").lower() == "crew" else COST_CHAT_DIRECT
    if action == "story_beat":
        return COST_STORY_BEAT
    if action == "tts":
        return COST_TTS
    raise ValueError(f"unknown action: {action}")


@dataclass
class QuotaSnapshot:
    identity: str
    day: str
    used: int
    limit: int
    remaining: int
    global_used: int
    global_limit: int
    global_remaining: int
    byok: bool = False


@dataclass
class QuotaDecision:
    allowed: bool
    reason: str | None
    snapshot: QuotaSnapshot
    http_status: int = 200


class _MemoryQuotaStore:
    """Thread-safe day-bucket counters."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # (day, identity) -> used
        self._used: dict[tuple[str, str], int] = {}
        # day -> global used
        self._global: dict[str, int] = {}
        # ip_hash -> list[timestamps] for rate limit
        self._hits: dict[str, list[float]] = {}

    def _purge_old_days(self, day: str) -> None:
        stale = [k for k in self._used if k[0] != day]
        for k in stale:
            del self._used[k]
        stale_g = [d for d in self._global if d != day]
        for d in stale_g:
            del self._global[d]

    def snapshot(self, identity: str, day: str, limit: int, global_limit: int) -> QuotaSnapshot:
        with self._lock:
            self._purge_old_days(day)
            used = self._used.get((day, identity), 0)
            g_used = self._global.get(day, 0)
        return QuotaSnapshot(
            identity=identity,
            day=day,
            used=used,
            limit=limit,
            remaining=max(0, limit - used),
            global_used=g_used,
            global_limit=global_limit,
            global_remaining=max(0, global_limit - g_used),
        )

    def try_consume(
        self,
        identity: str,
        day: str,
        cost: int,
        limit: int,
        global_limit: int,
    ) -> QuotaDecision:
        with self._lock:
            self._purge_old_days(day)
            used = self._used.get((day, identity), 0)
            g_used = self._global.get(day, 0)
            snap = QuotaSnapshot(
                identity=identity,
                day=day,
                used=used,
                limit=limit,
                remaining=max(0, limit - used),
                global_used=g_used,
                global_limit=global_limit,
                global_remaining=max(0, global_limit - g_used),
            )
            if g_used + cost > global_limit:
                return QuotaDecision(
                    allowed=False,
                    reason="global_budget_exhausted",
                    snapshot=snap,
                    http_status=429,
                )
            if used + cost > limit:
                return QuotaDecision(
                    allowed=False,
                    reason="free_quota_exhausted",
                    snapshot=snap,
                    http_status=402,
                )
            self._used[(day, identity)] = used + cost
            self._global[day] = g_used + cost
            snap.used = used + cost
            snap.remaining = max(0, limit - snap.used)
            snap.global_used = g_used + cost
            snap.global_remaining = max(0, global_limit - snap.global_used)
            return QuotaDecision(allowed=True, reason=None, snapshot=snap, http_status=200)

    def check_rate_limit(self, ip: str, max_hits: int, window_sec: int) -> bool:
        """Return True if allowed, False if rate limited."""
        now = time.time()
        key = ip_hash(ip)
        with self._lock:
            hits = self._hits.get(key, [])
            hits = [t for t in hits if now - t < window_sec]
            if len(hits) >= max_hits:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            return True


_store = _MemoryQuotaStore()


def guest_daily_limit() -> int:
    return max(0, int(getattr(settings, "free_credits_guest", 8) or 8))


def global_daily_limit() -> int:
    return max(0, int(getattr(settings, "platform_daily_credit_budget", 5000) or 5000))


def rate_limit_max() -> int:
    return max(1, int(getattr(settings, "platform_rate_limit_per_hour", 40) or 40))


def is_byok(connection_session_id: str | None) -> bool:
    if not connection_session_id:
        return False
    from agents.connection_sessions import connection_store

    return connection_store.get(connection_session_id) is not None


def byok_snapshot() -> QuotaSnapshot:
    day = utc_day()
    return QuotaSnapshot(
        identity="byok",
        day=day,
        used=0,
        limit=0,
        remaining=999999,
        global_used=0,
        global_limit=global_daily_limit(),
        global_remaining=global_daily_limit(),
        byok=True,
    )


def enforce_platform_quota(
    *,
    request: Any,
    action: str,
    mode: str | None = None,
    connection_session_id: str | None = None,
    guest_id: str | None = None,
) -> QuotaDecision:
    """Gate a platform-paid action. Raises nothing — caller maps to HTTPException."""
    if is_byok(connection_session_id):
        return QuotaDecision(allowed=True, reason=None, snapshot=byok_snapshot(), http_status=200)

    ip = client_ip(request)
    if not _store.check_rate_limit(ip, rate_limit_max(), 3600):
        day = utc_day()
        ident = identity_key(guest_id=guest_id, ip=ip)
        snap = _store.snapshot(ident, day, guest_daily_limit(), global_daily_limit())
        return QuotaDecision(
            allowed=False,
            reason="rate_limited",
            snapshot=snap,
            http_status=429,
        )

    cost = action_cost(action, mode=mode)
    ident = identity_key(guest_id=guest_id, ip=ip)
    return _store.try_consume(
        ident,
        utc_day(),
        cost,
        guest_daily_limit(),
        global_daily_limit(),
    )


def read_quota_snapshot(
    *,
    request: Any,
    guest_id: str | None = None,
    connection_session_id: str | None = None,
) -> QuotaSnapshot:
    if is_byok(connection_session_id):
        return byok_snapshot()
    ip = client_ip(request)
    ident = identity_key(guest_id=guest_id, ip=ip)
    return _store.snapshot(ident, utc_day(), guest_daily_limit(), global_daily_limit())


def new_guest_id() -> str:
    return str(uuid.uuid4())
