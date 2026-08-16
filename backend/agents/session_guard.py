"""Opaque session capability keys (defense in depth beyond UUID session ids)."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any


def new_session_key() -> str:
    return secrets.token_urlsafe(32)


def hash_session_key(raw: str) -> str:
    return hashlib.sha256(raw.strip().encode("utf-8")).hexdigest()


def session_key_matches(raw: str | None, hashed: Any) -> bool:
    """Legacy rows / test mocks without a string hash are allowed."""
    if not isinstance(hashed, str) or not hashed:
        return True
    if not raw or not isinstance(raw, str) or not raw.strip():
        return False
    digest = hash_session_key(raw)
    return hmac.compare_digest(digest, hashed)


def extract_session_key(request: Any, *, query_key: str | None = None) -> str | None:
    try:
        header = request.headers.get("x-session-key") or request.headers.get("X-Session-Key")
        if header and isinstance(header, str) and header.strip():
            return header.strip()
    except Exception:
        pass
    if query_key and isinstance(query_key, str) and query_key.strip():
        return query_key.strip()
    return None
