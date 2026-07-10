"""Request-bounded Director story generation for serverless runtimes."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from models.schemas import AgentEvent


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


def _session_row(*, outline: str | None = None, next_beat_index: int = 0):
    return SimpleNamespace(
        id="sess-1",
        task_prompt="Walter needs leverage.",
        plot_outline=outline,
        next_beat_index=next_beat_index,
        active_character_id="walter",
        status="active",
    )


def _factory_for(session):
    db = MagicMock()
    db.execute = AsyncMock(return_value=_ScalarResult(session))
    db.commit = AsyncMock()

    class _SessionContext:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *exc_info):
            return False

    return lambda: _SessionContext(), db


async def test_process_next_beat_persists_progress_before_non_final_ready(director):
    session = _session_row()
    session_factory, db = _factory_for(session)
    director._generate_outline = AsyncMock(
        return_value="1. RV - Walt waits\n2. Superlab - Gus arrives"
    )
    beat_calls: list[dict] = []

    async def fake_beat(*args, **kwargs):
        beat_calls.append(kwargs)
        yield AgentEvent(
            type="agent_speak",
            data={"character_id": "Walter White", "content": "Wait."},
        )
        yield AgentEvent(
            type="beat_ready",
            data={"beat_id": "beat_1", "beat_summary": "RV"},
        )

    director._generate_beat = fake_beat

    events = [
        event
        async for event in director.process_next_beat(
            session_factory=session_factory,
            session_id="sess-1",
            language="en",
        )
    ]

    assert session.plot_outline == "1. RV - Walt waits\n2. Superlab - Gus arrives"
    assert session.next_beat_index == 1
    assert session.status == "waiting"
    assert beat_calls[0]["beat_index"] == 0
    assert beat_calls[0]["active_character_id"] == "Walter White"
    assert [event.type for event in events] == [
        "status",
        "outline",
        "status",
        "agent_speak",
        "beat_ready",
    ]
    assert events[-1].data["is_final"] is False
    assert db.commit.await_count >= 2


async def test_process_next_beat_emits_complete_after_final_ready(director):
    session = _session_row(
        outline="1. RV - Walt waits\n2. Superlab - Gus arrives",
        next_beat_index=1,
    )
    session_factory, _db = _factory_for(session)
    director._generate_outline = AsyncMock()

    async def fake_beat(*args, **kwargs):
        yield AgentEvent(
            type="beat_ready",
            data={"beat_id": "beat_2", "beat_summary": "Superlab"},
        )

    director._generate_beat = fake_beat

    events = [
        event
        async for event in director.process_next_beat(
            session_factory=session_factory,
            session_id="sess-1",
        )
    ]

    assert director._generate_outline.await_count == 0
    assert session.next_beat_index == 2
    assert session.status == "complete"
    assert [event.type for event in events] == ["beat_ready", "complete"]
    assert events[0].data["is_final"] is True
