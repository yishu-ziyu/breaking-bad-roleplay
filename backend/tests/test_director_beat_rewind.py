"""P2 (full-stack review) — beat rewind on undelivered generation.

Problem being fixed: ``process_next_beat`` claims a beat by advancing
``next_beat_index`` BEFORE the (long) beat generation. If the stream dies
mid-generation — LLM exception, client abort, proxy cut — the advance
persists, so the next request claims the NEXT beat and the paid-for beat
is silently skipped forever.

Contract under test: after the claim, if the generator ends (exception,
aclose, or error) without emitting the final ``beat_ready``,
``next_beat_index`` is rewound to the claimed index — but only if no
concurrent request has advanced past it (``value == claimed + 1``).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from models.schemas import AgentEvent

_OUTLINE = "1. RV - Walt waits\n2. Superlab - Gus arrives"


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


def _session_row(*, outline: str, next_beat_index: int = 0):
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


async def test_rewind_after_generation_exception(director):
    """_generate_beat raises mid-stream -> claim is rewound to 0."""
    session = _session_row(outline=_OUTLINE)
    session_factory, db = _factory_for(session)

    async def failing_beat(*args, **kwargs):
        yield AgentEvent(type="agent_speak", data={"character_id": "Walter White", "content": "Wait."})
        raise RuntimeError("provider exploded mid-beat")

    director._generate_beat = failing_beat

    seen = []
    with pytest.raises(RuntimeError):
        async for event in director.process_next_beat(
            session_factory=session_factory, session_id="sess-1"
        ):
            seen.append(event.type)

    assert "agent_speak" in seen
    assert session.next_beat_index == 0, (
        "undelivered beat must be rewound so a reconnect retries the SAME beat"
    )
    assert db.commit.await_count >= 2  # claim + rewind commits


async def test_rewind_when_client_aborts_mid_stream(director):
    """Consumer closes the generator mid-beat (client disconnect path:
    routes' heartbeat wrapper acloses the source) -> claim is rewound."""
    session = _session_row(outline=_OUTLINE, next_beat_index=1)
    session_factory, _db = _factory_for(session)

    async def slow_beat(*args, **kwargs):
        yield AgentEvent(type="status", data={"message": "thinking"})
        # The consumer will aclose() before this event is pulled.
        yield AgentEvent(type="agent_speak", data={"character_id": "Walter White", "content": "later"})
        yield AgentEvent(type="beat_ready", data={"beat_id": "beat_2"})

    director._generate_beat = slow_beat

    agen = director.process_next_beat(
        session_factory=session_factory, session_id="sess-1"
    )
    first = await agen.__anext__()
    assert first.type == "status"
    await agen.aclose()

    assert session.next_beat_index == 1, (
        "abandoned beat 1 must be rewound from the claimed value of 2"
    )


async def test_no_rewind_on_successful_delivery(director):
    session = _session_row(outline=_OUTLINE)
    session_factory, _db = _factory_for(session)

    async def ok_beat(*args, **kwargs):
        yield AgentEvent(type="beat_ready", data={"beat_id": "beat_1"})

    director._generate_beat = ok_beat

    events = [
        e async for e in director.process_next_beat(
            session_factory=session_factory, session_id="sess-1"
        )
    ]
    assert events[-1].type == "beat_ready"
    assert session.next_beat_index == 1  # stays advanced


async def test_rewind_never_clobbers_a_concurrent_advance(director):
    """If another request already advanced past this claim, the rewind must
    leave next_beat_index alone (only rewind value == claimed + 1)."""
    session = _session_row(outline=_OUTLINE)
    session_factory, _db = _factory_for(session)

    async def racing_beat(*args, **kwargs):
        yield AgentEvent(type="status", data={"message": "thinking"})
        # Simulate a concurrent request committing a further advance.
        session.next_beat_index = 4
        raise RuntimeError("died anyway")

    director._generate_beat = racing_beat

    with pytest.raises(RuntimeError):
        async for _ in director.process_next_beat(
            session_factory=session_factory, session_id="sess-1"
        ):
            pass

    assert session.next_beat_index == 4, "must not rewind a beat index another request advanced past us"
