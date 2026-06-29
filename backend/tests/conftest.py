"""Shared pytest fixtures for backend tests.

Fixtures defined here are auto-discovered by pytest — no import needed
in test modules. This file eliminates duplicate fixture definitions
that were scattered across test files (M5) and fixes mock fidelity
issues where mock_provider returned a stale model route and mock_db
had inconsistent method sets (M4).
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def mock_provider():
    """Mock ProviderFacade with the real default model route.

    The real ProviderFacade.resolve_model_route always returns
    "stepfun/step-3.7-flash" (MiniMax routing was disabled). Tests that
    need a different route can override this attribute on the returned
    mock object.
    """
    provider = MagicMock()
    provider.call_model = AsyncMock()
    provider.resolve_model_route = MagicMock(
        return_value="stepfun/step-3.7-flash"
    )
    return provider


@pytest.fixture
def director(mock_provider):
    """DirectorAgent wired to the mock provider."""
    from agents.director import DirectorAgent
    return DirectorAgent(provider=mock_provider)


@pytest.fixture
def mock_db():
    """Mock AsyncSession with the full method set matching the real
    SQLAlchemy AsyncSession signature:

    - execute: async, returns MagicMock by default
    - add:     sync (NOT async — matches real AsyncSession.add)
    - commit:  async
    - rollback: async

    Individual tests can override any method (e.g., set
    `mock_db.execute = AsyncMock(return_value=...)`) without affecting
    the others.
    """
    db = MagicMock()
    db.execute = AsyncMock()
    db.add = MagicMock()      # sync on real AsyncSession
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


@pytest.fixture
def mock_session_factory(mock_db):
    """Factory returning an async context manager that yields ``mock_db``.

    Mirrors the real ``async_session_factory`` usage pattern
    ``async with session_factory() as session:`` so code paths exercised
    by tests (Cycle 45 / H1: short-lived sessions in director + stream
    endpoint) can be driven against the mock session without touching a
    real DB. All "sessions" produced by this factory share the same
    ``mock_db`` instance, so call-count assertions on ``mock_db.execute``
    etc. aggregate across logical sessions just as they did when a single
    request-level session was mocked.
    """
    class _SessionCM:
        async def __aenter__(self):
            return mock_db

        async def __aexit__(self, *exc_info):
            return False  # do not suppress exceptions

    return lambda: _SessionCM()
