"""Tests for cross-session character dossier persistence."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

from db.models import CharacterDossier
from agents.memory import update_dossiers


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
            "model_route": "minimax/MiniMax-M3",
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
