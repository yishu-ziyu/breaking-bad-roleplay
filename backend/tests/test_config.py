"""Cycle 38 — config + CORS fixes (Additional #5).

Part A — ALLOWED_ORIGINS default empty string silently blocks all CORS in
production. Tests verify the parsing helper:
  - wildcard, multi-origin, whitespace-stripping, empty-in-dev (no warning),
    empty-in-production (WARNING logged).

Part B — MINIMAX_API_KEY and STEPFUN_API_KEY were both implicitly required.
Relaxed to "at least one required" via a pydantic model_validator. Tests
verify: both missing raises, either-alone succeeds, both-present succeeds.

The Settings tests instantiate ``Settings(_env_file=None)`` so they never
read the local ``.env`` file — making them deterministic in CI and immune
to whatever real keys a developer has locally. ``monkeypatch`` controls the
env vars for each scenario and restores them afterwards.
"""

from __future__ import annotations

import logging

import pytest
from pydantic import ValidationError

# Settings() reads env vars at import time. Set fakes BEFORE importing
# config/main so this module can be collected in CI without a .env file.
# ``setdefault`` avoids overriding real values when a .env file is present.
import os

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

from config import Settings  # noqa: E402
from main import _parse_allowed_origins  # noqa: E402


# ---------------------------------------------------------------------------
# Part B — API key mandatory validation
# ---------------------------------------------------------------------------

_DB_URL = "postgresql+asyncpg://test:test@localhost:5432/test"


def _make_settings(**env_overrides):
    """Build a Settings instance with ``_env_file=None`` (no .env loading)
    and the given env vars applied via monkeypatch-style overrides.

    Caller is responsible for monkeypatching env vars; this helper only
    disables the .env file so local dev secrets don't leak into tests.
    """
    return Settings(_env_file=None)


class TestApiKeyValidation:
    def test_both_api_keys_missing_raises(self, monkeypatch):
        """No API key at all → ValidationError (cannot call any provider)."""
        monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
        monkeypatch.delenv("STEPFUN_API_KEY", raising=False)
        monkeypatch.setenv("DATABASE_URL", _DB_URL)
        with pytest.raises(ValidationError) as exc_info:
            _make_settings()
        # The validator's message must surface so operators know what's wrong.
        msg = str(exc_info.value).lower()
        assert "at least one" in msg
        assert "minimax_api_key" in msg or "stepfun_api_key" in msg

    def test_only_minimax_key_ok(self, monkeypatch):
        """Single-provider (MiniMax only) deployment must work."""
        monkeypatch.setenv("MINIMAX_API_KEY", "mk-xxx")
        monkeypatch.delenv("STEPFUN_API_KEY", raising=False)
        monkeypatch.setenv("DATABASE_URL", _DB_URL)
        s = _make_settings()
        assert s.minimax_api_key == "mk-xxx"
        assert s.stepfun_api_key == ""

    def test_only_stepfun_key_ok(self, monkeypatch):
        """Single-provider (StepFun only) deployment must work."""
        monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
        monkeypatch.setenv("STEPFUN_API_KEY", "sf-yyy")
        monkeypatch.setenv("DATABASE_URL", _DB_URL)
        s = _make_settings()
        assert s.stepfun_api_key == "sf-yyy"
        assert s.minimax_api_key == ""

    def test_both_api_keys_present_ok(self, monkeypatch):
        """Both keys present — original happy path still works."""
        monkeypatch.setenv("MINIMAX_API_KEY", "mk-1")
        monkeypatch.setenv("STEPFUN_API_KEY", "sf-2")
        monkeypatch.setenv("DATABASE_URL", _DB_URL)
        s = _make_settings()
        assert s.minimax_api_key == "mk-1"
        assert s.stepfun_api_key == "sf-2"

    def test_database_url_still_required(self, monkeypatch):
        """DATABASE_URL has no fallback — must stay mandatory."""
        monkeypatch.setenv("MINIMAX_API_KEY", "mk-x")
        monkeypatch.delenv("STEPFUN_API_KEY", raising=False)
        monkeypatch.delenv("DATABASE_URL", raising=False)
        with pytest.raises(ValidationError):
            _make_settings()


class TestDirectorRuntimeProfile:
    def test_defaults_preserve_full_local_enrichment(self, monkeypatch):
        monkeypatch.setenv("MINIMAX_API_KEY", "mk-x")
        monkeypatch.delenv("STEPFUN_API_KEY", raising=False)
        monkeypatch.setenv("DATABASE_URL", _DB_URL)
        monkeypatch.delenv("DIRECTOR_MODEL_ROUTE", raising=False)
        monkeypatch.delenv("ENABLE_DOSSIER_UPDATES", raising=False)

        settings = _make_settings()

        assert settings.director_model_route == "stepfun/step-2-16k"
        assert settings.enable_dossier_updates is True

    def test_vercel_profile_can_select_minimax_and_defer_dossiers(self, monkeypatch):
        monkeypatch.setenv("MINIMAX_API_KEY", "mk-x")
        monkeypatch.delenv("STEPFUN_API_KEY", raising=False)
        monkeypatch.setenv("DATABASE_URL", _DB_URL)
        monkeypatch.setenv("DIRECTOR_MODEL_ROUTE", "minimax/MiniMax-M3")
        monkeypatch.setenv("ENABLE_DOSSIER_UPDATES", "false")

        settings = _make_settings()

        assert settings.director_model_route == "minimax/MiniMax-M3"
        assert settings.enable_dossier_updates is False


# ---------------------------------------------------------------------------
# Part A — ALLOWED_ORIGINS parsing + production warning
# ---------------------------------------------------------------------------


class TestParseAllowedOrigins:
    def test_wildcard_returns_allow_all(self):
        assert _parse_allowed_origins("*", "development") == ["*"]

    def test_wildcard_in_production_also_allowed(self):
        # "*" is permitted (operator's explicit choice); the warning only
        # fires for the *empty* default. This test pins that distinction.
        assert _parse_allowed_origins("*", "production") == ["*"]

    def test_multi_origin_parsed_to_list(self):
        result = _parse_allowed_origins(
            "https://a.example.com,https://b.example.com", "production"
        )
        assert result == ["https://a.example.com", "https://b.example.com"]

    def test_whitespace_and_empty_segments_are_stripped(self):
        result = _parse_allowed_origins(
            " https://a.com , , https://b.com , ", "production"
        )
        assert result == ["https://a.com", "https://b.com"]

    def test_empty_in_development_returns_empty_no_warning(self, caplog):
        with caplog.at_level(logging.WARNING, logger="main"):
            result = _parse_allowed_origins("", "development")
        assert result == []
        # No warning in development — empty is a valid (if useless) dev state.
        cors_warnings = [
            r for r in caplog.records
            if "ALLOWED_ORIGINS" in r.getMessage()
        ]
        assert cors_warnings == []

    def test_empty_in_production_logs_warning(self, caplog):
        with caplog.at_level(logging.WARNING, logger="main"):
            result = _parse_allowed_origins("", "production")
        assert result == []
        # The misconfiguration must be visible in logs.
        warnings = [
            r
            for r in caplog.records
            if r.levelno == logging.WARNING and "ALLOWED_ORIGINS" in r.getMessage()
        ]
        assert len(warnings) == 1
        assert "production" in warnings[0].getMessage().lower()

    def test_empty_whitespace_only_in_production_logs_warning(self, caplog):
        # A string of just spaces is effectively empty after strip().
        with caplog.at_level(logging.WARNING, logger="main"):
            result = _parse_allowed_origins("   ", "production")
        assert result == []
        warnings = [
            r
            for r in caplog.records
            if r.levelno == logging.WARNING and "ALLOWED_ORIGINS" in r.getMessage()
        ]
        assert len(warnings) == 1
