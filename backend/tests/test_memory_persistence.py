"""Tests for cross-session character dossier persistence."""

from __future__ import annotations

import json
import logging
from unittest.mock import AsyncMock, MagicMock

from db.models import CharacterDossier
from agents.memory import (
    MAX_KNOWLEDGE_ENTRIES,
    MAX_RELATIONSHIP_NOTES_CHARS,
    _apply_dossier_delta,
    compute_dossier_delta,
    update_dossiers,
)


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


# ---------------------------------------------------------------------------
# Cycle 46 / M4 — unbounded growth caps
# ---------------------------------------------------------------------------


def _dossier_with_knowledge(n_entries: int) -> CharacterDossier:
    """Build a dossier whose knowledge dict already has ``n_entries`` keys,
    sorted lexicographically so the oldest is unambiguously first."""
    knowledge = {
        f"beat_2020-01-01T00:00:{i:02d}.000000": f"old fact {i}"
        for i in range(n_entries)
    }
    return CharacterDossier(
        session_id=None,
        owner_id="walter_white",
        subject_id="jesse_pinkman",
        trust_level=5,
        knowledge=json.dumps(knowledge, ensure_ascii=False),
        relationship_notes="",
    )


class TestCycle46_KnowledgeGrowthCap:
    """M4: ``_apply_dossier_delta`` previously appended a new timestamped
    key to the knowledge dict on every beat without ever evicting. In a
    long-running world-level dossier (session_id=None, shared across all
    playthroughs) this could grow a single Text column to MB-scale. The
    cap now keeps the most recent ``MAX_KNOWLEDGE_ENTRIES`` entries.
    """

    def test_knowledge_capped_at_max_entries_oldest_dropped(self):
        """Given a dossier already at the cap, applying one more delta
        drops the single oldest entry rather than letting the dict grow."""
        dossier = _dossier_with_knowledge(MAX_KNOWLEDGE_ENTRIES)
        # Sanity: pre-condition has exactly MAX entries.
        pre = json.loads(dossier.knowledge)
        assert len(pre) == MAX_KNOWLEDGE_ENTRIES

        _apply_dossier_delta(
            dossier,
            trust_delta=0,
            new_knowledge="fresh fact from this beat",
            new_notes="",
        )

        post = json.loads(dossier.knowledge)
        assert len(post) == MAX_KNOWLEDGE_ENTRIES, "cap must hold at MAX entries"
        # The oldest pre-existing key must be gone.
        oldest_key = "beat_2020-01-01T00:00:00.000000"
        assert oldest_key not in post, "oldest entry must be evicted"
        # The newest pre-existing key must survive.
        newest_pre_key = f"beat_2020-01-01T00:00:{MAX_KNOWLEDGE_ENTRIES - 1:02d}.000000"
        assert newest_pre_key in post, "newest pre-existing entry must survive"
        # The freshly added entry must be present.
        assert "fresh fact from this beat" in post.values()

    def test_knowledge_below_cap_is_left_untouched(self):
        """Regression guard: when the dict is below the cap, no entries
        are evicted — the cap only trims on overflow."""
        dossier = _dossier_with_knowledge(MAX_KNOWLEDGE_ENTRIES - 1)

        _apply_dossier_delta(
            dossier,
            trust_delta=0,
            new_knowledge="another fact",
            new_notes="",
        )

        post = json.loads(dossier.knowledge)
        assert len(post) == MAX_KNOWLEDGE_ENTRIES, "grows to exactly MAX, no trim yet"
        oldest_key = "beat_2020-01-01T00:00:00.000000"
        assert oldest_key in post, "no eviction when not overflowing"

    def test_knowledge_empty_new_knowledge_leaves_dict_unchanged(self):
        """Empty new_knowledge short-circuits — the dict is not touched
        and certainly not trimmed (no overflow path entered)."""
        dossier = _dossier_with_knowledge(MAX_KNOWLEDGE_ENTRIES)
        pre_keys = set(json.loads(dossier.knowledge).keys())

        _apply_dossier_delta(dossier, trust_delta=1, new_knowledge="", new_notes="")

        post_keys = set(json.loads(dossier.knowledge).keys())
        assert post_keys == pre_keys, "no knowledge write when new_knowledge is empty"


class TestCycle46_RelationshipNotesGrowthCap:
    """M4: ``relationship_notes`` previously concatenated one line per beat
    forever. The cap now keeps only the trailing
    ``MAX_RELATIONSHIP_NOTES_CHARS`` characters so a long-running dossier
    row stays bounded.
    """

    def test_relationship_notes_truncated_to_cap_when_overflowing(self):
        """Given notes already over the cap, applying a delta truncates
        to the most recent ``MAX_RELATIONSHIP_NOTES_CHARS`` chars."""
        # Start with notes well over the cap.
        overflow_tail = "X" * (MAX_RELATIONSHIP_NOTES_CHARS + 500)
        dossier = CharacterDossier(
            session_id=None,
            owner_id="walter_white",
            subject_id="jesse_pinkman",
            trust_level=5,
            knowledge="{}",
            relationship_notes=overflow_tail,
        )

        _apply_dossier_delta(
            dossier,
            trust_delta=0,
            new_knowledge="",
            new_notes="latest note",
        )

        assert len(dossier.relationship_notes) <= MAX_RELATIONSHIP_NOTES_CHARS
        # The newest note must be visible in the truncated tail.
        assert "latest note" in dossier.relationship_notes
        # The truncation must have actually happened (we started above cap).
        assert len(dossier.relationship_notes) < len(overflow_tail) + 100

    def test_relationship_notes_below_cap_left_intact(self):
        """Regression guard: short notes are not truncated."""
        short_notes = "[00:00] first meeting"
        dossier = CharacterDossier(
            session_id=None,
            owner_id="walter_white",
            subject_id="jesse_pinkman",
            trust_level=5,
            knowledge="{}",
            relationship_notes=short_notes,
        )

        _apply_dossier_delta(
            dossier,
            trust_delta=0,
            new_knowledge="",
            new_notes="second note",
        )

        assert short_notes in dossier.relationship_notes
        assert "second note" in dossier.relationship_notes
        assert len(dossier.relationship_notes) <= MAX_RELATIONSHIP_NOTES_CHARS

