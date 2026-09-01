"""Platform free-tier quota + burst rate limits.

Security goals:
- Platform API keys never leave the server (enforced elsewhere).
- Free demo usage is capped per identity and per site-day.
- BYOK bind sessions skip this meter (user pays their own provider).
- Identity is guest_id (UUID) + IP hash; guest rotation is limited by IP rate limits.

Persistence tiers (P3, full-stack review):
1. Redis Lua token buckets when ``REDIS_URL`` is configured.
2. Postgres daily counters (``_DbQuotaStore``, Alembic d4e5f6a7b8c9) —
   survive restarts and stay coherent across workers without Redis.
3. In-process ``_MemoryQuotaStore`` only as a last resort.

BYOK gating is tri-state (``connection_store.binding_state``): a presented
but unresolvable connection id is "binding_lost", never "platform" —
falling back to platform billing there would silently spend the operator's
API keys for traffic the user believes runs on their own key.
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

from sqlalchemy import text

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


class _QuotaDenied(Exception):
    """Raised inside the consume transaction to roll back a denied tier."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class _DbQuotaStore:
    """P3: durable Postgres tier for daily counters (no Redis required).

    Before this tier existed, the production stack (REDIS_URL unset) counted
    guest credits in an in-process dict: every deploy reset the daily
    allowance (infinitely farmable) and every extra worker kept its own
    copy. Consume/refund are two guarded upserts in ONE transaction — the
    global row rolls back when the identity row would exceed its limit.

    The raw SQL is deliberately portable (Postgres + sqlite) so the unit
    suite exercises the real statements on aiosqlite. Tables: Alembic
    revision d4e5f6a7b8c9.
    """

    _CONSUME_GLOBAL = text(
        "INSERT INTO quota_usage_global (day, used) VALUES (:day, :cost_ins) "
        "ON CONFLICT (day) DO UPDATE SET used = used + :cost_add "
        "WHERE used + :cost_add <= :global_limit"
    )
    _CONSUME_IDENTITY = text(
        "INSERT INTO quota_usage (day, identity, used) "
        "VALUES (:day, :identity, :cost_ins) "
        "ON CONFLICT (day, identity) DO UPDATE SET used = used + :cost_add "
        "WHERE used + :cost_add <= :limit"
    )
    _REFUND_IDENTITY = text(
        "UPDATE quota_usage "
        "SET used = CASE WHEN used > :cost THEN used - :cost ELSE 0 END "
        "WHERE day = :day AND identity = :identity"
    )
    _REFUND_GLOBAL = text(
        "UPDATE quota_usage_global "
        "SET used = CASE WHEN used > :cost THEN used - :cost ELSE 0 END "
        "WHERE day = :day"
    )
    _SELECT_IDENTITY = text(
        "SELECT used FROM quota_usage WHERE day = :day AND identity = :identity"
    )
    _SELECT_GLOBAL = text("SELECT used FROM quota_usage_global WHERE day = :day")

    def __init__(self, session_factory: Any | None = None) -> None:
        self._injected_factory = session_factory

    def _factory(self):
        if self._injected_factory is None:
            from db.session import async_session_factory

            self._injected_factory = async_session_factory
        return self._injected_factory

    @staticmethod
    def _params(identity: str, day: str, cost: int, limit: int, global_limit: int) -> dict:
        # Distinct names because asyncpg + SQLAlchemy text() repeated
        # named binds are a footgun; the sqlite tier dedupes fine.
        return {
            "day": day,
            "identity": identity,
            "cost": cost,
            "cost_ins": cost,
            "cost_add": cost,
            "limit": limit,
            "global_limit": global_limit,
        }

    async def snapshot(
        self, identity: str, day: str, limit: int, global_limit: int
    ) -> QuotaSnapshot:
        async with self._factory()() as db:
            used = (
                await db.execute(
                    self._SELECT_IDENTITY, {"day": day, "identity": identity}
                )
            ).scalar()
            g_used = (
                await db.execute(self._SELECT_GLOBAL, {"day": day})
            ).scalar()
        used_i = int(used or 0)
        g_i = int(g_used or 0)
        return QuotaSnapshot(
            identity=identity,
            day=day,
            used=used_i,
            limit=limit,
            remaining=max(0, limit - used_i),
            global_used=g_i,
            global_limit=global_limit,
            global_remaining=max(0, global_limit - g_i),
        )

    async def try_consume(
        self, identity: str, day: str, cost: int, limit: int, global_limit: int
    ) -> QuotaDecision:
        p = self._params(identity, day, cost, limit, global_limit)
        try:
            async with self._factory()() as db:
                async with db.begin():
                    g = await db.execute(self._CONSUME_GLOBAL, p)
                    if g.rowcount != 1:
                        raise _QuotaDenied("global_budget_exhausted")
                    i = await db.execute(self._CONSUME_IDENTITY, p)
                    if i.rowcount != 1:
                        raise _QuotaDenied("free_quota_exhausted")
        except _QuotaDenied as denied:
            snap = await self.snapshot(identity, day, limit, global_limit)
            return QuotaDecision(
                allowed=False,
                reason=denied.reason,
                snapshot=snap,
                http_status=402 if denied.reason == "free_quota_exhausted" else 429,
            )
        snap = await self.snapshot(identity, day, limit, global_limit)
        return QuotaDecision(allowed=True, reason=None, snapshot=snap, http_status=200)

    async def refund(
        self, identity: str, day: str, cost: int, limit: int, global_limit: int
    ) -> QuotaSnapshot:
        p = {"day": day, "identity": identity, "cost": cost}
        async with self._factory()() as db:
            async with db.begin():
                await db.execute(self._REFUND_IDENTITY, p)
                await db.execute(self._REFUND_GLOBAL, p)
        return await self.snapshot(identity, day, limit, global_limit)


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
        self._db = _DbQuotaStore()
        self._db_failed_at = 0.0
        self._redis_client: Any = None
        self._redis_available = False

    # -- fallback chain (P3): Redis -> durable DB tier -> in-process memory --

    def _db_tier(self) -> _DbQuotaStore | None:
        """None when the DB tier is in its 5-minute failure backoff."""
        if self._db_failed_at and time.time() - self._db_failed_at < 300:
            return None
        return self._db

    def _mark_db_failed(self, exc: Exception) -> None:
        first = self._db_failed_at == 0.0
        self._db_failed_at = time.time()
        logger.warning(
            "quota: DB tier unavailable (%s), using memory fallback%s",
            exc,
            " — retrying in 300s" if not first else " for 300s",
        )

    async def _fallback_snapshot(self, identity, day, limit, global_limit) -> QuotaSnapshot:
        db_tier = self._db_tier()
        if db_tier is not None:
            try:
                return await db_tier.snapshot(identity, day, limit, global_limit)
            except Exception as exc:
                self._mark_db_failed(exc)
        return self._memory.snapshot(identity, day, limit, global_limit)

    async def _fallback_consume(self, identity, day, cost, limit, global_limit) -> QuotaDecision:
        db_tier = self._db_tier()
        if db_tier is not None:
            try:
                return await db_tier.try_consume(identity, day, cost, limit, global_limit)
            except Exception as exc:
                self._mark_db_failed(exc)
        return self._memory.try_consume(identity, day, cost, limit, global_limit)

    async def _fallback_refund(self, identity, day, cost, limit, global_limit) -> QuotaSnapshot:
        db_tier = self._db_tier()
        if db_tier is not None:
            try:
                return await db_tier.refund(identity, day, cost, limit, global_limit)
            except Exception as exc:
                self._mark_db_failed(exc)
        return self._memory.refund(identity, day, cost, limit, global_limit)

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
            return await self._fallback_snapshot(identity, day, limit, global_limit)

        identity_key = f"quota:{day}:{identity}"
        global_key = f"quota:{day}:global"
        try:
            used = int(await self._redis_client.get(identity_key) or 0)  # type: ignore[union-attr]
            g_used = int(await self._redis_client.get(global_key) or 0)  # type: ignore[union-attr]
        except Exception:
            return await self._fallback_snapshot(identity, day, limit, global_limit)

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
            return await self._fallback_consume(identity, day, cost, limit, global_limit)

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
            return await self._fallback_consume(identity, day, cost, limit, global_limit)

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
            return await self._fallback_refund(identity, day, cost, limit, global_limit)

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
            return await self._fallback_refund(identity, day, cost, limit, global_limit)

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
    # P3 (full-stack review): tri-state binding check. Only a genuinely
    # ABSENT connection id means "platform user". An id that was presented
    # but no longer resolves (server restart / TTL) must fail honestly with
    # binding_expired — billing it to the platform would silently spend the
    # operator's keys for traffic the user believes runs on their own key.
    from agents.connection_sessions import connection_store

    state = connection_store.binding_state(connection_session_id)
    if state == "byok":
        return QuotaDecision(allowed=True, reason=None, snapshot=byok_snapshot(), http_status=200)
    if state == "binding_lost":
        snap = byok_snapshot()
        snap.byok = False
        snap.tier = "byok"
        return QuotaDecision(
            allowed=False, reason="binding_expired", snapshot=snap, http_status=410
        )

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
