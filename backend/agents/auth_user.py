"""Resolve authenticated Supabase user for platform free-tier tiers.

Logged-in users get a higher daily free credit pool (early-access benefit).
Guest traffic stays on the lower guest pool.

Verification: call Supabase Auth ``GET /auth/v1/user`` with the access token.
Requires ``SUPABASE_URL`` + ``SUPABASE_ANON_KEY`` (or publishable key) on the server.
Tokens are cached briefly so quota checks do not hammer Auth on every event.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

_CACHE_TTL_SEC = 90.0
_cache_lock = threading.Lock()
# token_hash -> (user_id, expires_at)
_token_cache: dict[str, tuple[str, float]] = {}


@dataclass(frozen=True)
class AuthUser:
    user_id: str
    email: str | None = None


def _token_fingerprint(token: str) -> str:
    # Do not store raw tokens in the cache key longer than needed; use a short hash.
    import hashlib

    return hashlib.sha256(token.encode()).hexdigest()[:32]


def extract_bearer_token(request: Any, *, query_access_token: str | None = None) -> str | None:
    """Bearer header first; EventSource may pass access_token query."""
    try:
        auth = request.headers.get("authorization") or request.headers.get("Authorization")
        if auth and isinstance(auth, str):
            parts = auth.strip().split(None, 1)
            if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
                return parts[1].strip()
    except Exception:
        pass
    if query_access_token and isinstance(query_access_token, str):
        tok = query_access_token.strip()
        if tok:
            return tok
    return None


def resolve_auth_user(request: Any, *, query_access_token: str | None = None) -> AuthUser | None:
    token = extract_bearer_token(request, query_access_token=query_access_token)
    if not token:
        return None

    url = (getattr(settings, "supabase_url", None) or "").strip().rstrip("/")
    anon = (
        (getattr(settings, "supabase_anon_key", None) or "").strip()
        or (getattr(settings, "supabase_publishable_key", None) or "").strip()
    )
    if not url or not anon:
        # Misconfigured: cannot elevate to logged-in tier.
        logger.warning("Supabase auth not configured; treating request as guest for quota")
        return None

    fp = _token_fingerprint(token)
    now = time.time()
    with _cache_lock:
        hit = _token_cache.get(fp)
        if hit and hit[1] > now:
            return AuthUser(user_id=hit[0])
        # Drop expired entries opportunistically
        if hit:
            _token_cache.pop(fp, None)

    try:
        with httpx.Client(timeout=4.0) as client:
            resp = client.get(
                f"{url}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": anon,
                },
            )
    except Exception:
        logger.exception("Supabase user probe failed")
        return None

    if resp.status_code != 200:
        return None

    try:
        data = resp.json()
    except Exception:
        return None

    user_id = data.get("id")
    if not user_id or not isinstance(user_id, str):
        return None
    email = data.get("email")
    if email is not None and not isinstance(email, str):
        email = None

    with _cache_lock:
        _token_cache[fp] = (user_id, now + _CACHE_TTL_SEC)
        # Bound cache size
        if len(_token_cache) > 2000:
            for k, (_, exp) in list(_token_cache.items())[:500]:
                if exp <= now:
                    _token_cache.pop(k, None)

    return AuthUser(user_id=user_id, email=email)


def clear_auth_cache() -> None:
    with _cache_lock:
        _token_cache.clear()
