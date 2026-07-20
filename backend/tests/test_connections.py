"""BYOK connection store + multi-preset catalog smoke tests."""

from __future__ import annotations

import os

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")

from agents.byok_presets import PROVIDER_PRESETS, known_provider_ids, preset_by_id
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


def test_get_slides_ttl_and_public_view():
    from agents.connection_sessions import session_public_view

    store = ConnectionSessionStore(ttl_seconds=60)
    session = store.bind(
        provider_id="openai",
        model_id="gpt-4o-mini",
        llm_key="sk-abcdef1234",
        base_url="https://api.openai.com/v1",
    )
    first_exp = session.expires_at
    loaded = store.get(session.id)
    assert loaded is not None
    assert loaded.expires_at >= first_exp
    view = session_public_view(loaded)
    assert view["connectionSessionId"] == session.id
    assert view["providerId"] == "openai"
    assert view["modelId"] == "gpt-4o-mini"
    assert view["hasLlmKey"] is True
    assert view["hint"].startswith("…")
    assert "sk-abcdef" not in view["hint"]


def test_credential_context_scoped():
    assert get_credential_override() is None
    ov = CredentialOverride(provider_id="minimax", llm_key="secret")
    with use_credentials(ov):
        assert get_credential_override() is not None
        assert get_credential_override().llm_key == "secret"
    assert get_credential_override() is None


def test_provider_catalog_includes_byok_presets():
    from api.routes import PROVIDER_CATALOG, _platform_flags

    ids = {p["id"] for p in PROVIDER_CATALOG}
    # Platform demo still only two flags; catalog is the full BYOK surface.
    assert "minimax" in ids
    assert "stepfun" in ids
    assert "deepseek" in ids
    assert "openai" in ids
    assert "custom" in ids
    assert "cliproxy" not in ids
    flags = _platform_flags()
    assert set(flags.keys()) == {"minimax", "stepfun"}
    step = next(p for p in PROVIDER_CATALOG if p["id"] == "stepfun")
    assert step["defaultModel"] == "step-3.7-flash"
    for p in PROVIDER_CATALOG:
        assert "defaultModel" in p
        assert "displayName" in p
        assert "kind" in p
        assert p["kind"] in ("openai", "anthropic")


def test_preset_helpers():
    assert "deepseek" in known_provider_ids()
    deepseek = preset_by_id("deepseek")
    assert deepseek is not None
    assert deepseek["kind"] == "openai"
    assert deepseek["defaultBaseUrl"].startswith("https://")
    assert preset_by_id("nope") is None
    assert len(PROVIDER_PRESETS) >= 8


def test_bind_openai_compatible_preset_stores_base_url():
    store = ConnectionSessionStore(ttl_seconds=60)
    session = store.bind(
        provider_id="deepseek",
        model_id="deepseek-chat",
        llm_key="sk-deepseek-test",
        base_url="https://api.deepseek.com",
    )
    loaded = store.get(session.id)
    assert loaded is not None
    assert loaded.override.provider_id == "deepseek"
    assert loaded.override.base_url == "https://api.deepseek.com"
    assert loaded.override.model_id == "deepseek-chat"
