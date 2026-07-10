"""Cycle 40 — SSE stream endpoint tests (L2 continued).

Covers ``GET /api/session/{id}/stream`` — the last critical API path that
had no test coverage. This endpoint returns a ``text/event-stream`` response
whose body is produced by an async generator that wraps
``DirectorAgent.process()``.

Mock strategy
-------------
- DB: ``app.dependency_overrides[get_db]`` returns a mock AsyncSession so
  tests never touch real Postgres.
- Director: ``app.dependency_overrides[get_director]`` returns a mock whose
  ``process`` attribute is a real async generator function yielding
  predefined ``AgentEvent`` objects. This keeps the test free of any real
  LLM call while still exercising the SSE formatting + ordering in
  ``routes.py``.
- Lifespan: ``httpx.ASGITransport`` does not run the ASGI lifespan, so
  ``app.state.provider`` / ``app.state.director`` are never built; the
  dependency overrides make the routes not look at ``app.state`` at all.

Streaming assertions
--------------------
``httpx.AsyncClient`` + ``ASGITransport`` is used instead of the synchronous
``TestClient`` because ``TestClient`` buffers the full response before
returning, which loses the ability to assert event ordering semantics on a
true streaming endpoint. With ``client.stream("GET", ...)`` we read the body
chunk-by-chunk via ``aiter_text()`` and parse the SSE frames ourselves.

SSE frame format (per routes.py):
    event: <type>\n
    data: <AgentEvent.model_dump_json()>\n
    \n
"""

from __future__ import annotations

import json
import os
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

# Settings() reads env vars at import time. Set fakes BEFORE importing main
# so the module can be imported in CI without a .env file. ``setdefault``
# avoids overriding real values when a .env file is present locally.
os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

from api.routes import get_db, get_director  # noqa: E402
from main import app  # noqa: E402
from models.schemas import AgentEvent  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_db():
    """Mock AsyncSession for route dependency injection.

    Note (Cycle 45 / H1): ``stream_session`` no longer takes a request-
    level DB session via ``Depends(get_db)``. Instead it imports
    ``async_session_factory`` at module level and opens short-lived
    sessions for the existence check and per-event stop-signal check.
    The ``client`` fixture patches ``api.routes.async_session_factory``
    with a factory yielding this mock_db, so the existing per-test
    ``mock_db.execute`` side_effect / return_value setup continues to
    work. ``get_db`` is still overridden for any non-stream endpoint
    that happens to be exercised, but the stream path no longer uses it.
    """
    db = MagicMock()
    db.execute = AsyncMock()
    db.add = MagicMock()  # sync on real AsyncSession
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    return db


@pytest.fixture
def mock_director():
    """Mock DirectorAgent.

    Tests assign ``mock_director.process_next_beat = <async generator function>`` to
    control the event stream. Using a real async generator function (rather
    than AsyncMock) is required because routes.py consumes it with
    ``async for event in director.process(...)``.
    """
    return MagicMock()


@pytest.fixture
def mock_session_factory(mock_db):
    """Factory whose ``async with factory() as session:`` yields mock_db.

    Stand-in for ``api.routes.async_session_factory`` so the stream
    endpoint's short-lived session blocks (existence check + per-event
    stop-signal check) run against the mock. All "sessions" produced by
    this factory share the same ``mock_db`` instance, preserving the
    existing ``mock_db.execute`` call-order / count assertions.
    """
    class _SessionCM:
        async def __aenter__(self):
            return mock_db

        async def __aexit__(self, *exc_info):
            return False

    return lambda: _SessionCM()


@pytest.fixture
async def client(mock_db, mock_director, mock_session_factory):
    """``httpx.AsyncClient`` bound to the FastAPI app via ``ASGITransport``.

    ``get_director`` is overridden so the route never touches the real
    Director singleton on ``app.state``. ``get_db`` is also overridden
    for any non-stream endpoint. The stream endpoint sources its DB
    sessions from ``api.routes.async_session_factory`` (Cycle 45 / H1),
    so we patch that module attribute with ``mock_session_factory``.
    ASGITransport does not run lifespan, and schema migration is an explicit
    deployment step rather than an app-startup side effect.
    """
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_director] = lambda: mock_director

    try:
        with patch("api.routes.async_session_factory", mock_session_factory):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as c:
                yield c
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _scalar_result(value):
    """Build a mock SQLAlchemy Result whose ``scalar_one_or_none()`` returns
    ``value`` (a Session row or None)."""
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    return result


def _make_session_row(
    session_id: str = "sess-stream-1",
    status: str = "active",
    task_prompt: str = "Cook a batch in the RV",
):
    """Build a mock Session row that ``stream_session`` can read."""
    session = MagicMock()
    session.id = session_id
    session.status = status
    session.task_prompt = task_prompt
    return session


def parse_sse_events(text: str) -> list[tuple[str, dict]]:
    """Parse a raw SSE text body into a list of ``(event_type, data_dict)``.

    Handles the exact frame format emitted by routes.py:
        event: <type>\n
        data: <json>\n
        \n
    Blank lines separate frames. Multi-line ``data:`` fields are not used by
    routes.py, but we accumulate them just in case.
    """
    events: list[tuple[str, dict]] = []
    current_event: str | None = None
    current_data: list[str] = []

    for line in text.split("\n"):
        if line.startswith("event: "):
            current_event = line[len("event: ") :].strip()
        elif line.startswith("data: "):
            current_data.append(line[len("data: ") :])
        elif line == "":
            # Frame boundary
            if current_event is not None:
                data_str = "\n".join(current_data)
                try:
                    data = json.loads(data_str) if data_str else {}
                except json.JSONDecodeError:
                    data = {"_raw": data_str}
                events.append((current_event, data))
                current_event = None
                current_data = []
        # Lines that are neither event:/data:/blank are ignored (e.g. stray
        # whitespace or comments) — routes.py does not emit them.

    # If the body did not end with a blank line, flush the last frame.
    if current_event is not None:
        data_str = "\n".join(current_data)
        try:
            data = json.loads(data_str) if data_str else {}
        except json.JSONDecodeError:
            data = {"_raw": data_str}
        events.append((current_event, data))

    return events


async def _read_stream(resp: httpx.Response) -> str:
    """Read a streaming response body to a string via ``aiter_text``."""
    chunks: list[str] = []
    async for chunk in resp.aiter_text():
        chunks.append(chunk)
    return "".join(chunks)


# ---------------------------------------------------------------------------
# Predefined async generator functions used as ``mock_director.process_next_beat``
# ---------------------------------------------------------------------------


async def _happy_path_process(
    *args, **kwargs
) -> AsyncIterator[AgentEvent]:
    """Yield a representative full event sequence for one beat."""
    yield AgentEvent(
        type="status", data={"message": "Director is analysing the task…"}
    )
    yield AgentEvent(
        type="outline",
        data={"content": "1. RV in the desert — Walt and Jesse cook"},
    )
    yield AgentEvent(
        type="scene_change",
        data={
            "from_scene": "unknown",
            "to_scene": "RV in the desert",
            "description": "Opening location.",
        },
    )
    yield AgentEvent(
        type="agent_think",
        data={
            "character_id": "Walter White",
            "thought_content": "If the batch fails, I lose everything.",
        },
    )
    yield AgentEvent(
        type="agent_speak",
        data={
            "character_id": "Walter White",
            "content": "Jesse, watch the temperature.",
            "emotion_state": "tense",
            "gif_search_query": "walter white tense serious",
        },
    )
    yield AgentEvent(
        type="beat_ready",
        data={"beat_id": "beat_1", "beat_summary": "RV in the desert"},
    )


async def _failing_process(
    *args, **kwargs
) -> AsyncIterator[AgentEvent]:
    """Yield one event, then raise — simulates a mid-stream LLM failure."""
    yield AgentEvent(
        type="status", data={"message": "Director is analysing the task…"}
    )
    raise RuntimeError("LLM provider exploded")


# ---------------------------------------------------------------------------
# Tests — happy path
# ---------------------------------------------------------------------------


class TestStreamHappyPath:
    async def test_stream_uses_one_beat_director_interface(
        self, client, mock_db, mock_director
    ):
        """The HTTP stream must not enter the legacy multi-beat wait loop."""
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )
        calls: list[dict] = []

        async def one_beat(*args, **kwargs) -> AsyncIterator[AgentEvent]:
            calls.append(kwargs)
            yield AgentEvent(
                type="beat_ready",
                data={"beat_id": "beat_1", "is_final": False},
            )

        async def legacy_process_must_not_run(*args, **kwargs) -> AsyncIterator[AgentEvent]:
            raise AssertionError("legacy multi-beat process was called")
            yield  # pragma: no cover

        mock_director.process_next_beat = one_beat
        mock_director.process = legacy_process_must_not_run

        async with client.stream(
            "GET", "/api/session/sess-stream-1/stream"
        ) as resp:
            body = await _read_stream(resp)

        events = parse_sse_events(body)
        assert [event_type for event_type, _ in events] == ["beat_ready"]
        assert len(calls) == 1
        assert callable(calls[0]["session_factory"])
        assert calls[0]["session_id"] == "sess-stream-1"
        assert calls[0]["voice_example"] is None
        assert calls[0]["language"] == "en"

    async def test_full_event_sequence_and_ordering(
        self, client, mock_db, mock_director
    ):
        """Happy path: status → outline → scene_change → agent_think →
        agent_speak → beat_ready, in that exact order."""
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )
        mock_director.process_next_beat = _happy_path_process

        async with client.stream(
            "GET", "/api/session/sess-stream-1/stream"
        ) as resp:
            assert resp.status_code == 200
            body = await _read_stream(resp)

        events = parse_sse_events(body)
        event_types = [evt_type for evt_type, _ in events]
        assert event_types == [
            "status",
            "outline",
            "scene_change",
            "agent_think",
            "agent_speak",
            "beat_ready",
        ]
        # beat_ready must be the final event in this happy path.
        assert events[-1][0] == "beat_ready"

    async def test_content_type_is_text_event_stream(
        self, client, mock_db, mock_director
    ):
        """The Content-Type header must advertise SSE."""
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )
        mock_director.process_next_beat = _happy_path_process

        async with client.stream(
            "GET", "/api/session/sess-stream-1/stream"
        ) as resp:
            assert resp.status_code == 200
            content_type = resp.headers.get("content-type", "")
            assert "text/event-stream" in content_type
            await resp.aread()  # drain so the stream closes cleanly

    async def test_sse_frame_format_event_and_data_prefixes(
        self, client, mock_db, mock_director
    ):
        """Each frame must start with ``event:`` and carry a JSON ``data:``
        line whose payload round-trips through ``AgentEvent``."""
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )
        mock_director.process_next_beat = _happy_path_process

        async with client.stream(
            "GET", "/api/session/sess-stream-1/stream"
        ) as resp:
            assert resp.status_code == 200
            body = await _read_stream(resp)

        # Every frame boundary is a blank line; each frame has both prefixes.
        frames = [f for f in body.split("\n\n") if f.strip()]
        assert len(frames) >= 1
        for frame in frames:
            lines = frame.split("\n")
            assert any(line.startswith("event: ") for line in lines), frame
            data_lines = [line for line in lines if line.startswith("data: ")]
            assert len(data_lines) == 1, frame
            payload = json.loads(data_lines[0][len("data: ") :])
            assert "type" in payload
            assert "data" in payload

    async def test_agent_speak_payload_carries_dialogue_fields(
        self, client, mock_db, mock_director
    ):
        """The agent_speak event data must include character_id, content,
        emotion_state, and gif_search_query (the fields the frontend
        renders)."""
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )
        mock_director.process_next_beat = _happy_path_process

        async with client.stream(
            "GET", "/api/session/sess-stream-1/stream"
        ) as resp:
            body = await _read_stream(resp)

        events = parse_sse_events(body)
        speak_events = [d for t, d in events if t == "agent_speak"]
        assert len(speak_events) == 1
        speak = speak_events[0]["data"]
        assert speak["character_id"] == "Walter White"
        assert speak["content"] == "Jesse, watch the temperature."
        assert speak["emotion_state"] == "tense"
        assert speak["gif_search_query"] == "walter white tense serious"


# ---------------------------------------------------------------------------
# Tests — error paths
# ---------------------------------------------------------------------------


class TestStreamErrors:
    async def test_director_raise_emits_error_event(
        self, client, mock_db, mock_director
    ):
        """When ``director.process`` raises mid-stream, routes.py must catch
        it and emit a sanitised ``error`` event (no raw exception text)."""
        mock_db.execute = AsyncMock(
            return_value=_scalar_result(_make_session_row())
        )
        mock_director.process_next_beat = _failing_process

        async with client.stream(
            "GET", "/api/session/sess-stream-1/stream"
        ) as resp:
            assert resp.status_code == 200  # error is in-band, not HTTP 5xx
            body = await _read_stream(resp)

        events = parse_sse_events(body)
        event_types = [t for t, _ in events]
        # The status event yielded before the raise must still be present.
        assert "status" in event_types
        assert "error" in event_types
        # The error event must be the last frame.
        assert events[-1][0] == "error"
        err_data = events[-1][1]["data"]
        assert "message" in err_data
        # Sanitisation: the raw exception text must NOT leak to the client.
        assert "LLM provider exploded" not in err_data["message"]
        assert "RuntimeError" not in err_data["message"]

    async def test_missing_session_returns_404(self, client, mock_db):
        """A session_id that does not exist in the DB must yield HTTP 404,
        not an SSE error event (the check happens before the stream starts)."""
        mock_db.execute = AsyncMock(return_value=_scalar_result(None))

        resp = await client.get("/api/session/does-not-exist/stream")
        assert resp.status_code == 404
        assert "Session not found" in resp.json()["detail"]

    async def test_empty_task_prompt_returns_400(
        self, client, mock_db, mock_director
    ):
        """A session whose ``task_prompt`` is empty must yield HTTP 400 —
        the Director has nothing to run on."""
        session = _make_session_row(task_prompt="")
        mock_db.execute = AsyncMock(return_value=_scalar_result(session))
        mock_director.process_next_beat = _happy_path_process  # should not be called

        resp = await client.get("/api/session/sess-stream-1/stream")
        assert resp.status_code == 400
        assert "task_prompt" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Predefined async generator functions — stop-signal fixtures (Cycle 42)
# ---------------------------------------------------------------------------


async def _three_beat_process(*args, **kwargs) -> AsyncIterator[AgentEvent]:
    """Yield three distinguishable beats for stop-signal tests.

    Distinct types make it easy to assert which beats were discarded
    after the stop check fired.
    """
    yield AgentEvent(type="status", data={"message": "beat 1"})
    yield AgentEvent(type="outline", data={"content": "beat 2 outline"})
    yield AgentEvent(type="beat_ready", data={"beat_id": "beat_3"})


async def _two_event_process(*args, **kwargs) -> AsyncIterator[AgentEvent]:
    """Yield two events for the happy stop-signal test."""
    yield AgentEvent(type="status", data={"message": "beat 1"})
    yield AgentEvent(type="beat_ready", data={"beat_id": "beat_1"})


# ---------------------------------------------------------------------------
# Tests — stop signal (Cycle 42)
# ---------------------------------------------------------------------------


class TestStreamStopSignal:
    """Cycle 42 — event_generator must terminate when session.status is
    flipped to "paused"/"stopped" mid-stream by POST /action.

    The status check re-reads ``session.status`` from the DB before each
    yield, so a stop action issued in a separate request actually
    terminates the SSE stream instead of letting it run on and burn LLM
    tokens the user believed were cancelled.
    """

    async def test_stream_terminates_when_session_paused(
        self, client, mock_db, mock_director
    ):
        """A mid-stream ``session.status`` flip to "paused" must stop the
        stream: emit a terminal status event and break, discarding any
        remaining director events."""
        session = _make_session_row(status="active")
        mock_director.process_next_beat = _three_beat_process
        # db.execute call sequence:
        #   0: initial session load in stream_session        -> session row
        #   1: status check before yielding beat 1           -> "active"
        #   2: status check before yielding beat 2           -> "paused" (break)
        mock_db.execute = AsyncMock(
            side_effect=[
                _scalar_result(session),
                _scalar_result("active"),
                _scalar_result("paused"),
            ]
        )

        async with client.stream(
            "GET", "/api/session/sess-stream-1/stream"
        ) as resp:
            assert resp.status_code == 200
            body = await _read_stream(resp)

        events = parse_sse_events(body)

        # Beat 1 was yielded (status was active), then the stop check
        # fired on beat 2 and broke the loop.
        assert len(events) == 2, events
        assert events[0][0] == "status"
        assert events[0][1]["data"]["message"] == "beat 1"
        # Terminal stop event.
        assert events[1][0] == "status"
        assert events[1][1]["data"].get("stopped") is True
        # Beats 2 and 3 must NOT have been emitted.
        all_types = [t for t, _ in events]
        assert "outline" not in all_types
        assert "beat_ready" not in all_types

    async def test_stream_continues_when_status_active(
        self, client, mock_db, mock_director
    ):
        """When ``session.status`` stays "active" throughout, the stop
        check must not interfere — all director events are yielded in
        order and no terminal stop event is emitted."""
        session = _make_session_row(status="active")
        mock_director.process_next_beat = _two_event_process
        # db.execute call sequence:
        #   0: initial session load              -> session row
        #   1: status check before beat 1        -> "active"
        #   2: status check before beat_ready    -> "active"
        mock_db.execute = AsyncMock(
            side_effect=[
                _scalar_result(session),
                _scalar_result("active"),
                _scalar_result("active"),
            ]
        )

        async with client.stream(
            "GET", "/api/session/sess-stream-1/stream"
        ) as resp:
            assert resp.status_code == 200
            body = await _read_stream(resp)

        events = parse_sse_events(body)
        assert [t for t, _ in events] == ["status", "beat_ready"]
        # No terminal stop event on the happy path.
        for _, payload in events:
            assert payload.get("data", {}).get("stopped") is not True
        # The stop-signal check must actually run on every event —
        # 1 initial session load + 2 per-event status checks. Without
        # the fix this would be 1 (only the initial load), so this
        # guards against the check being silently dropped.
        assert mock_db.execute.await_count == 3
