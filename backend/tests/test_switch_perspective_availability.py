"""T9: switch_perspective must fail loudly on unknown target_character.

Given a story session (legacy row without runtime v1 ``world_state`` or a
runtime v1 row),
When ``POST /api/session/{id}/action`` carries
``{"action": "switch_perspective", "target_character": <not playable>}``,
Then it must answer 400 with the same contract as ``/api/chat`` (T4):
``{"code": "unknown_character", "message", "characterId"}`` plus a server
log — never persist the raw id and later skip its rewrite in the renderer.

And given a playable character (e.g. ``hank``),
When the same action is sent,
Then behavior is unchanged: 200, canonical frontend short id persisted,
session unlocked (status ``active``).
"""

from __future__ import annotations

import logging
import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

# Settings() reads env vars at import time. Set fakes BEFORE importing main.
os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

from api.routes import get_db  # noqa: E402
from main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.execute = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    return db


@pytest.fixture
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    return result


def _make_session_row(
    *,
    session_id: str = "sess-legacy",
    status: str = "waiting",
    world_state=None,
    active_character_id: str = "walter",
):
    """Mock Session row.

    ``world_state=None`` models a legacy save (no runtime v1 JSON string);
    a string value models a runtime v1 session.
    """
    session = MagicMock()
    session.id = session_id
    session.status = status
    session.task_prompt = "Cook a batch in the RV"
    session.title = "chapter one"
    session.plot_outline = "1. RV - Cook"
    session.next_beat_index = 2
    session.active_character_id = active_character_id
    session.world_state = world_state
    session.world_revision = 3
    session.pending_command_id = None
    session.last_command_id = None
    return session


def _post_switch(client, target: str, session_id: str = "sess-legacy"):
    return client.post(
        f"/api/session/{session_id}/action",
        json={
            "action": "switch_perspective",
            "target_character": target,
            "command_id": "switch_cmd_1",
            "expected_revision": 3,
        },
    )


# ---------------------------------------------------------------------------
# 1. Unknown target_character -> typed 400, nothing persisted
# ---------------------------------------------------------------------------


def test_legacy_switch_perspective_rejects_unknown_target(client, mock_db, caplog):
    session = _make_session_row()
    mock_db.execute = AsyncMock(return_value=_scalar_result(session))

    with caplog.at_level(logging.WARNING, logger="api.routes"):
        resp = _post_switch(client, "gomez")

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert isinstance(detail, dict)
    assert detail["code"] == "unknown_character"
    assert detail["characterId"] == "gomez"
    assert "gomez" in detail["message"]
    # Nothing persisted, nothing unlocked: the raw id never reaches the row.
    assert session.active_character_id == "walter"
    assert session.status == "waiting"
    assert mock_db.commit.await_count == 0
    # Server-side log names the rejected id.
    assert any(
        "gomez" in record.getMessage() and "unknown character" in record.getMessage()
        for record in caplog.records
    ), "unknown switch target must be logged server-side"


def test_runtime_v1_switch_perspective_rejects_unknown_target(client, mock_db):
    session = _make_session_row(
        session_id="sess-runtime",
        status="waiting",
        world_state='{"player_id": "walter", "present": ["walter"]}',
    )
    mock_db.execute = AsyncMock(return_value=_scalar_result(session))

    resp = _post_switch(client, "gomez", session_id="sess-runtime")

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["code"] == "unknown_character"
    assert detail["characterId"] == "gomez"
    assert session.active_character_id == "walter"
    assert mock_db.commit.await_count == 0


def test_switch_perspective_missing_target_still_returns_required_error(client, mock_db):
    session = _make_session_row()
    mock_db.execute = AsyncMock(return_value=_scalar_result(session))

    resp = client.post(
        "/api/session/sess-legacy/action",
        json={"action": "switch_perspective"},
    )

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "target_character" in detail


# ---------------------------------------------------------------------------
# 2. Known characters keep working (legacy path persists canonical short id)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("target", ["hank", "Hank Schrader", "HANK"])
def test_legacy_switch_perspective_known_character_still_works(client, mock_db, target):
    session = _make_session_row()
    mock_db.execute = AsyncMock(return_value=_scalar_result(session))

    resp = _post_switch(client, target)

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert session.active_character_id == "hank"
    assert session.status == "active"
    assert mock_db.commit.await_count >= 1
