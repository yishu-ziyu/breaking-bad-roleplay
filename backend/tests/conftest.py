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
