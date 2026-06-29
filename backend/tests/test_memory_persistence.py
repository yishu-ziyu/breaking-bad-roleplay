"""Tests for cross-session character dossier persistence."""

from __future__ import annotations

import json
import logging
from unittest.mock import AsyncMock, MagicMock

from db.models import CharacterDossier
from agents.memory import compute_dossier_delta, update_dossiers


class _Scalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _ExecuteResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _Scalars(self._rows)


class _DbStub:
    def __init__(self, session_rows=None, world_rows=None):
        self._results = [
            _ExecuteResult(session_rows or []),
            _ExecuteResult(world_rows or []),
        ]
        self.added = []
        self.commit = AsyncMock()

    async def execute(self, _stmt):
        return self._results.pop(0)

    def add(self, row):
        self.added.append(row)


def _provider_with_delta(delta):
    provider = MagicMock()
    provider.call_model = AsyncMock(return_value=json.dumps({"deltas": [delta]}))
    return provider


async def test_update_dossiers_creates_session_and_world_rows():
    """Given a new relationship delta, it is saved for this session and future sessions."""
    db = _DbStub()
    provider = _provider_with_delta(
        {
            "owner": "Walter White",
            "subject": "Jesse Pinkman",
            "trust_delta": 2,
            "new_knowledge": "Walter notices Jesse kept the plan quiet.",
            "new_notes": "Walter trusts Jesse slightly more.",
        }
    )

    applied = await update_dossiers(
        db=db,
        session_id="session-1",
        beat_summary="RV argument",
        beat_events=[{"type": "agent_speak", "data": {"character_id": "Walter White"}}],
        provider=provider,
    )

    assert applied == [
        {
            "owner": "walter_white",
            "subject": "jesse_pinkman",
            "trust_delta": 2,
            "new_knowledge": "Walter notices Jesse kept the plan quiet.",
            "world_persisted": True,
            "model_route": "stepfun/step-3.7-flash",
        }
    ]
    assert len(db.added) == 2
    session_row, world_row = db.added
    assert session_row.session_id == "session-1"
    assert world_row.session_id is None
    assert session_row.trust_level == 7
    assert world_row.trust_level == 7
    assert db.commit.await_count == 1


async def test_update_dossiers_accumulates_existing_world_memory():
    """Given a world dossier exists, later sessions update it instead of creating a duplicate."""
    world_row = CharacterDossier(
        session_id=None,
        owner_id="walter_white",
        subject_id="jesse_pinkman",
        trust_level=6,
        knowledge=json.dumps({"initial": "Jesse helped Walter before."}),
        relationship_notes="Existing trust.",
    )
    db = _DbStub(world_rows=[world_row])
    provider = _provider_with_delta(
        {
            "owner": "Walter White",
            "subject": "Jesse Pinkman",
            "trust_delta": -3,
            "new_knowledge": "Walter sees Jesse hesitate under pressure.",
            "new_notes": "Walter becomes more doubtful.",
        }
    )

    await update_dossiers(
        db=db,
        session_id="session-2",
        beat_summary="Lab confrontation",
        beat_events=[{"type": "agent_act", "data": {"character_id": "Jesse Pinkman"}}],
        provider=provider,
    )

    assert len(db.added) == 1
    assert db.added[0].session_id == "session-2"
    assert world_row.trust_level == 3
    assert "Jesse helped Walter before." in world_row.knowledge
    assert "Walter sees Jesse hesitate under pressure." in world_row.knowledge
    assert "Walter becomes more doubtful." in world_row.relationship_notes
    assert db.commit.await_count == 1


async def test_compute_dossier_delta_logs_exception_on_provider_failure(caplog):
    """H4: a provider failure is logged at ERROR with a traceback, not
    silently swallowed. The function still returns empty deltas so the
    calling beat can continue, but the failure is now visible in logs.
    """
    provider = MagicMock()
    provider.call_model = AsyncMock(side_effect=RuntimeError("network timeout"))

    with caplog.at_level(logging.ERROR, logger="agents.memory"):
        result = await compute_dossier_delta(
            provider=provider,
            dossiers={},
            beat_summary="RV argument",
            beat_events=[],
        )

    assert result == {"deltas": []}
    # logger.exception emits an ERROR record whose message is the format
    # string and whose exc_info carries the traceback.
    failure_records = [
        r
        for r in caplog.records
        if r.levelname == "ERROR" and "compute_dossier_delta failed" in r.message
    ]
    assert failure_records, "expected an ERROR log record for the swallowed exception"
    assert failure_records[0].exc_info is not None


async def test_compute_dossier_delta_logs_exception_on_unexpected_error(caplog):
    """H4: any Exception subclass (not just network errors) is logged,
    so JSON bugs, provider coding errors, etc. surface in logs too."""
    provider = MagicMock()
    provider.call_model = AsyncMock(side_effect=ValueError("bad payload"))

    with caplog.at_level(logging.ERROR, logger="agents.memory"):
        result = await compute_dossier_delta(
            provider=provider,
            dossiers={"walter_white": {"trust_level": 5}},
            beat_summary="beat",
            beat_events=[{"type": "x"}],
        )

    assert result == {"deltas": []}
    assert any(
        r.levelname == "ERROR"
        and "compute_dossier_delta failed" in r.message
        and r.exc_info is not None
        for r in caplog.records
    )

