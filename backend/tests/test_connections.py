"""BYOK connection store + catalog smoke tests."""

from __future__ import annotations

import os

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")

from agents.connection_sessions import ConnectionSessionStore
from agents.credential_context import use_credentials, get_credential_override, CredentialOverride


def test_bind_and_get_roundtrip():
    store = ConnectionSessionStore(ttl_seconds=60)
    session = store.bind(
        provider_id="minimax",
        model_id="MiniMax-M3",
        llm_key="sk-test-abcdef",
        tts_key="sk-tts-xyz",
        region="cn",
    )
    assert session.id
    loaded = store.get(session.id)
    assert loaded is not None
    assert loaded.override.llm_key == "sk-test-abcdef"
    assert loaded.override.tts_key == "sk-tts-xyz"
    assert store.revoke(session.id) is True
    assert store.get(session.id) is None


def test_expired_session_returns_none():
    store = ConnectionSessionStore(ttl_seconds=0)
    session = store.bind(provider_id="stepfun", llm_key="k")
    # ttl 0 → immediately expired on next get
    assert store.get(session.id) is None


def test_credential_context_scoped():
    assert get_credential_override() is None
    ov = CredentialOverride(provider_id="minimax", llm_key="secret")
    with use_credentials(ov):
        assert get_credential_override() is not None
        assert get_credential_override().llm_key == "secret"
    assert get_credential_override() is None


def test_provider_catalog_constants():
    from api.routes import PROVIDER_CATALOG, _platform_flags

    ids = {p["id"] for p in PROVIDER_CATALOG}
    assert {"minimax", "stepfun", "cliproxy"} <= ids
    flags = _platform_flags()
    assert set(flags.keys()) == {"minimax", "stepfun", "cliproxy"}
    for p in PROVIDER_CATALOG:
        assert "defaultModel" in p
        assert "displayName" in p
