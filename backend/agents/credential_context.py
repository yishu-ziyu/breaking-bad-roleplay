"""Request-scoped credential overrides for BYOK (ContextVar).

Never log values from this module. Keys exist only for the duration of a
request / SSE generator turn.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Iterator, Optional


@dataclass(frozen=True)
class CredentialOverride:
    """Transient provider credentials for one request scope."""

    provider_id: str  # minimax | stepfun | cliproxy
    model_id: str | None = None
    llm_key: str | None = None
    tts_key: str | None = None
    base_url: str | None = None
    region: str | None = None  # cn | global (minimax)


_credential_override: ContextVar[Optional[CredentialOverride]] = ContextVar(
    "abq_credential_override",
    default=None,
)


def get_credential_override() -> CredentialOverride | None:
    return _credential_override.get()


def set_credential_override(override: CredentialOverride | None) -> Token:
    return _credential_override.set(override)


def reset_credential_override(token: Token) -> None:
    _credential_override.reset(token)


@contextmanager
def use_credentials(override: CredentialOverride | None) -> Iterator[None]:
    token = set_credential_override(override)
    try:
        yield
    finally:
        reset_credential_override(token)


def mask_hint(secret: str | None, tail: int = 4) -> str:
    if not secret:
        return ""
    cleaned = secret.strip()
    if len(cleaned) <= tail:
        return "…"
    return f"…{cleaned[-tail:]}"
