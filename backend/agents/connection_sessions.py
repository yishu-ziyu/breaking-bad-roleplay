"""In-memory BYOK connection sessions (RAM only, TTL).

Opaque tokens are safe to pass on SSE query strings. Raw keys never go in URLs.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass

from agents.credential_context import CredentialOverride, mask_hint

DEFAULT_TTL_SECONDS = 3600
MAX_SESSIONS = 500


@dataclass
class ConnectionSession:
    id: str
    override: CredentialOverride
    created_at: float
    expires_at: float

    def is_expired(self, now: float | None = None) -> bool:
        return (now if now is not None else time.time()) >= self.expires_at


class ConnectionSessionStore:
    def __init__(self, ttl_seconds: int = DEFAULT_TTL_SECONDS, max_sessions: int = MAX_SESSIONS):
        self._ttl = ttl_seconds
        self._max = max_sessions
        self._lock = threading.Lock()
        self._sessions: dict[str, ConnectionSession] = {}

    def bind(
        self,
        *,
        provider_id: str,
        model_id: str | None = None,
        llm_key: str | None = None,
        tts_key: str | None = None,
        base_url: str | None = None,
        region: str | None = None,
        ttl_seconds: int | None = None,
    ) -> ConnectionSession:
        now = time.time()
        ttl = ttl_seconds if ttl_seconds is not None else self._ttl
        with self._lock:
            self._purge_locked(now)
            if len(self._sessions) >= self._max:
                # Drop oldest
                oldest_id = min(self._sessions.items(), key=lambda kv: kv[1].created_at)[0]
                self._sessions.pop(oldest_id, None)
            sid = str(uuid.uuid4())
            session = ConnectionSession(
                id=sid,
                override=CredentialOverride(
                    provider_id=provider_id,
                    model_id=model_id,
                    llm_key=(llm_key.strip() if llm_key else None) or None,
                    tts_key=(tts_key.strip() if tts_key else None) or None,
                    base_url=(base_url.strip().rstrip("/") if base_url else None) or None,
                    region=region,
                ),
                created_at=now,
                expires_at=now + ttl,
            )
            self._sessions[sid] = session
            return session

    def get(self, session_id: str | None) -> ConnectionSession | None:
        if not session_id:
            return None
        now = time.time()
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            if session.is_expired(now):
                self._sessions.pop(session_id, None)
                return None
            # Sliding TTL on use
            session.expires_at = now + self._ttl
            return session

    def revoke(self, session_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None

    def _purge_locked(self, now: float) -> None:
        expired = [sid for sid, s in self._sessions.items() if s.is_expired(now)]
        for sid in expired:
            self._sessions.pop(sid, None)


# Process singleton
connection_store = ConnectionSessionStore()


def session_public_view(session: ConnectionSession) -> dict:
    ov = session.override
    hint_src = ov.llm_key or ov.tts_key or ""
    return {
        "connectionSessionId": session.id,
        "expiresAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(session.expires_at)),
        "providerId": ov.provider_id,
        "modelId": ov.model_id,
        "region": ov.region,
        "hint": mask_hint(hint_src),
        "hasLlmKey": bool(ov.llm_key),
        "hasTtsKey": bool(ov.tts_key),
        "hasBaseUrl": bool(ov.base_url),
    }
