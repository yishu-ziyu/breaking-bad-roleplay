"""Platform free-tier quota + burst rate limits.

Security goals:
- Platform API keys never leave the server (enforced elsewhere).
- Free demo usage is capped per identity and per site-day.
- BYOK bind sessions skip this meter (user pays their own provider).
- Identity is guest_id (UUID) + IP hash; guest rotation is limited by IP rate limits.

Persistence: Redis-backed token bucket (``RedisQuotaStore``) for multi-instance
consistency. Falls back to in-process ``_MemoryQuotaStore`` when Redis is
unavailable.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from config import settings

logger = logging.getLogger(__name__)

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


_IP_RE = re.compile(
    r"^(?:\d{1,3}\.){3}\d{1,3}$|"
    r"^[0-9a-fA-F:]+$"
)


def _looks_like_ip(value: str) -> bool:
    text = value.strip()
    if not text or not _IP_RE.match(text):
        return False
    if "." in text:
        parts = text.split(".")
        return len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)
    return ":" in text


def client_ip(request: Any) -> str:
    """Best-effort client IP.

    Do **not** trust client-supplied ``X-Forwarded-For`` (first hop is trivial
    to spoof and bypasses guest quota / rate limits). Prefer ``X-Real-IP``
    which nginx should set to ``$remote_addr``, then the socket peer.
    """
    try:
        real = request.headers.get("x-real-ip") or request.headers.get("X-Real-IP")
        if real and _looks_like_ip(real):
            return real.strip()
        if request.client and request.client.host:
            return request.client.host
    except Exception:
        pass
    return "unknown"


def ip_hash(ip: str) -> str:
    salt = (settings.quota_ip_salt or "abq-quota").encode()
    return hashlib.sha256(salt + ip.encode()).hexdigest()[:24]


def identity_key(
    *,
    guest_id: str | None,
    ip: str,
    user_id: str | None = None,
) -> str:
    """Stable free-tier identity.

    - Logged-in: one pool per Supabase user id (early-access 80-credit tier).
    - Guest: guest UUID scoped by IP hash so rotation cannot multiply free pools.
    """
    if user_id and isinstance(user_id, str) and user_id.strip():
        return f"u:{user_id.strip()}"
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
    if action == "session_create":
        return 0
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
    # "guest" | "user" | "byok"
    tier: str = "guest"
    # P2 (full-stack review): credits actually charged by
    # enforce_platform_quota for this call, so an undelivered billed action
    # (e.g. a story stream that died before beat_ready) can be refunded
    # exactly what it paid. 0 = nothing was charged (BYOK / free actions).
    cost: int = 0


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

    def refund(
        self, identity: str, day: str, cost: int, limit: int, global_limit: int
    ) -> QuotaSnapshot:
        """Give back previously consumed credits, clamped at zero (P2)."""
        with self._lock:
            self._purge_old_days(day)
            used = max(0, self._used.get((day, identity), 0) - cost)
            g_used = max(0, self._global.get(day, 0) - cost)
            self._used[(day, identity)] = used
            self._global[day] = g_used
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


class RedisQuotaStore:
    """Redis-backed quota store, atomic across multi-instance.

    Falls back to ``_MemoryQuotaStore`` when Redis is unavailable.
    Redis keys are namespaced as ``quota:{day}:{identity}`` for per-identity
    usage and ``quota:{day}:global`` for site-wide daily budget. Rate-limit
    sliding windows use ``rl:{ip_hash}`` sorted sets.
    """

    _TRY_CONSUME_LUA = """
local used = tonumber(redis.call('GET', KEYS[1]) or 0)
local g_used = tonumber(redis.call('GET', KEYS[2]) or 0)
if (g_used + tonumber(ARGV[1]) > tonumber(ARGV[3])) then
    return {0, used, g_used, 'global_budget_exhausted'}
end
if (used + tonumber(ARGV[1]) > tonumber(ARGV[2])) then
    return {0, used, g_used, 'free_quota_exhausted'}
end
redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('INCRBY', KEYS[2], ARGV[1])
redis.call('EXPIRE', KEYS[1], 86400)
redis.call('EXPIRE', KEYS[2], 86400)
return {1, used + tonumber(ARGV[1]), g_used + tonumber(ARGV[1]), ''}
"""

    _RATE_LIMIT_LUA = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
    return {0}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[1] .. ':' .. math.random())
redis.call('EXPIRE', KEYS[1], ARGV[2])
return {1}
"""

    def __init__(self, memory_fallback: _MemoryQuotaStore | None = None):
        self._memory = memory_fallback or _MemoryQuotaStore()
        self._redis_client: Any = None
        self._redis_available = False

    async def _ensure_redis(self) -> bool:
        """Try to connect to Redis. Returns True if successful."""
        if self._redis_available:
            return True
        try:
            import redis.asyncio as aioredis

            redis_url = getattr(settings, "redis_url", None) or os.environ.get("REDIS_URL", "")
            if not redis_url:
                return False
            self._redis_client = aioredis.from_url(
                redis_url,
                socket_connect_timeout=2,
                socket_timeout=2,
                decode_responses=True,
            )
            await self._redis_client.ping()
            self._redis_available = True
            logger.info("RedisQuotaStore: connected to Redis")
            return True
        except Exception as e:
            self._redis_available = False
            self._redis_client = None
            logger.warning("RedisQuotaStore: Redis unavailable, using memory fallback: %s", e)
            return False

    async def snapshot(
        self, identity: str, day: str, limit: int, global_limit: int
    ) -> QuotaSnapshot:
        if not await self._ensure_redis():
            return self._memory.snapshot(identity, day, limit, global_limit)

        identity_key = f"quota:{day}:{identity}"
        global_key = f"quota:{day}:global"
        try:
            used = int(await self._redis_client.get(identity_key) or 0)  # type: ignore[union-attr]
            g_used = int(await self._redis_client.get(global_key) or 0)  # type: ignore[union-attr]
        except Exception:
            return self._memory.snapshot(identity, day, limit, global_limit)

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

    async def try_consume(
        self,
        identity: str,
        day: str,
        cost: int,
        limit: int,
        global_limit: int,
    ) -> QuotaDecision:
        if not await self._ensure_redis():
            return self._memory.try_consume(identity, day, cost, limit, global_limit)

        identity_key = f"quota:{day}:{identity}"
        global_key = f"quota:{day}:global"
        try:
            result = await self._redis_client.eval(  # type: ignore[union-attr]
                self._TRY_CONSUME_LUA,
                3,
                identity_key,
                global_key,
                day,
                cost,
                limit,
                global_limit,
            )
            # result is a list: [allowed, used, g_used, reason]
            allowed = bool(result[0])
            used = int(result[1])
            g_used = int(result[2])
            reason = result[3] or None
        except Exception:
            return self._memory.try_consume(identity, day, cost, limit, global_limit)

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
        return QuotaDecision(
            allowed=allowed,
            reason=reason,
            snapshot=snap,
            http_status=402 if not allowed and reason == "free_quota_exhausted" else 429,
        )

    _REFUND_LUA = """
local used = tonumber(redis.call('DECRBY', KEYS[1], ARGV[1]))
if used < 0 then redis.call('SET', KEYS[1], 0); used = 0 end
local g_used = tonumber(redis.call('DECRBY', KEYS[2], ARGV[1]))
if g_used < 0 then redis.call('SET', KEYS[2], 0); g_used = 0 end
redis.call('EXPIRE', KEYS[1], 86400)
redis.call('EXPIRE', KEYS[2], 86400)
return {used, g_used}
"""

    async def refund(
        self, identity: str, day: str, cost: int, limit: int, global_limit: int
    ) -> QuotaSnapshot:
        """Give back consumed credits; falls back to memory without Redis (P2)."""
        if cost <= 0:
            return await self.snapshot(identity, day, limit, global_limit)
        if not await self._ensure_redis():
            return self._memory.refund(identity, day, cost, limit, global_limit)

        identity_key = f"quota:{day}:{identity}"
        global_key = f"quota:{day}:global"
        try:
            result = await self._redis_client.eval(  # type: ignore[union-attr]
                self._REFUND_LUA,
                2,
                identity_key,
                global_key,
                cost,
            )
            used = int(result[0])
            g_used = int(result[1])
        except Exception:
            return self._memory.refund(identity, day, cost, limit, global_limit)

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

    async def check_rate_limit(self, ip: str, max_hits: int, window_sec: int) -> bool:
        if not await self._ensure_redis():
            return self._memory.check_rate_limit(ip, max_hits, window_sec)

        key = f"rl:{ip_hash(ip)}"
        now = time.time()
        try:
            result = await self._redis_client.eval(  # type: ignore[union-attr]
                self._RATE_LIMIT_LUA,
                1,
                key,
                int(now),
                window_sec,
                max_hits,
            )
            return bool(result[0])
        except Exception:
            return self._memory.check_rate_limit(ip, max_hits, window_sec)


_store = RedisQuotaStore()


def _int_setting(name: str, default: int, *, minimum: int = 0) -> int:
    raw = getattr(settings, name, default)
    if raw is None:
        raw = default
    return max(minimum, int(raw))


def guest_daily_limit() -> int:
    return _int_setting("free_credits_guest", 8)


def user_daily_limit() -> int:
    """Logged-in early-access free pool (default 80)."""
    return _int_setting("free_credits_user", 80)


def daily_limit_for(*, user_id: str | None) -> int:
    if user_id:
        return user_daily_limit()
    return guest_daily_limit()


def global_daily_limit() -> int:
    return _int_setting("platform_daily_credit_budget", 5000)


def rate_limit_max() -> int:
    return _int_setting("platform_rate_limit_per_hour", 40, minimum=1)


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
        tier="byok",
    )


async def enforce_platform_quota(
    *,
    request: Any,
    action: str,
    mode: str | None = None,
    connection_session_id: str | None = None,
    guest_id: str | None = None,
    user_id: str | None = None,
    access_token: str | None = None,
) -> QuotaDecision:
    """Gate a platform-paid action. Raises nothing — caller maps to HTTPException."""
    if is_byok(connection_session_id):
        return QuotaDecision(allowed=True, reason=None, snapshot=byok_snapshot(), http_status=200)

    resolved_user_id = user_id
    if not resolved_user_id:
        try:
            import asyncio

            from agents.auth_user import resolve_auth_user

            auth = await asyncio.to_thread(
                lambda: resolve_auth_user(request, query_access_token=access_token)
            )
            if auth:
                resolved_user_id = auth.user_id
        except Exception:
            resolved_user_id = None

    ip = client_ip(request)
    limit = daily_limit_for(user_id=resolved_user_id)
    tier = "user" if resolved_user_id else "guest"

    if not await _store.check_rate_limit(ip, rate_limit_max(), 3600):
        day = utc_day()
        ident = identity_key(guest_id=guest_id, ip=ip, user_id=resolved_user_id)
        snap = await _store.snapshot(ident, day, limit, global_daily_limit())
        snap.tier = tier
        return QuotaDecision(
            allowed=False,
            reason="rate_limited",
            snapshot=snap,
            http_status=429,
        )

    cost = action_cost(action, mode=mode)
    ident = identity_key(guest_id=guest_id, ip=ip, user_id=resolved_user_id)
    decision = await _store.try_consume(
        ident,
        utc_day(),
        cost,
        limit,
        global_daily_limit(),
    )
    decision.snapshot.tier = tier
    if decision.allowed:
        # P2: remember what we charged so an undelivered billed action can be
        # refunded by the caller via refund_platform_quota(snapshot).
        decision.snapshot.cost = cost
    return decision


async def refund_platform_quota(snapshot: QuotaSnapshot | None) -> bool:
    """Return the credits a prior enforce_platform_quota charged for an
    action that never reached the client (P2). No-op (returns False) for
    BYOK / unbilled snapshots; True when a refund was recorded."""
    if snapshot is None or getattr(snapshot, "cost", 0) <= 0:
        return False
    await _store.refund(
        snapshot.identity,
        snapshot.day,
        snapshot.cost,
        snapshot.limit,
        snapshot.global_limit,
    )
    return True


async def read_quota_snapshot(
    *,
    request: Any,
    guest_id: str | None = None,
    connection_session_id: str | None = None,
    user_id: str | None = None,
    access_token: str | None = None,
) -> QuotaSnapshot:
    if is_byok(connection_session_id):
        return byok_snapshot()

    resolved_user_id = user_id
    if not resolved_user_id:
        try:
            import asyncio

            from agents.auth_user import resolve_auth_user

            auth = await asyncio.to_thread(
                lambda: resolve_auth_user(request, query_access_token=access_token)
            )
            if auth:
                resolved_user_id = auth.user_id
        except Exception:
            resolved_user_id = None

    ip = client_ip(request)
    limit = daily_limit_for(user_id=resolved_user_id)
    ident = identity_key(guest_id=guest_id, ip=ip, user_id=resolved_user_id)
    snap = await _store.snapshot(ident, utc_day(), limit, global_daily_limit())
    snap.tier = "user" if resolved_user_id else "guest"
    return snap


def new_guest_id() -> str:
    return str(uuid.uuid4())
