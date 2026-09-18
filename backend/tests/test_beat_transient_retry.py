"""Bounded retry for transient LLM transport failures inside one story beat.

Incident (2026-09-18): a single ``httpcore.ReadError`` ~6s into a 200 response
body read discarded a whole story beat. Director logged
``Beat 1 LLM call failed`` and ``story.renderer`` turned the error event into
``RuntimeError("character_turn_rejected")``, so the player lost the beat.

Contract under test:
1. One transient transport failure (httpx/httpcore ReadError / ConnectError /
   read timeout / remote protocol drop) gets one bounded retry inside the same
   beat; the beat succeeds when the retry succeeds.
2. Transient failures that exhaust the retry fail explicitly with a reason the
   caller can act on (``code=beat_llm_retry_exhausted``, ``retryable=True``),
   and the stream is billed once and refunded once — the retry never re-bills.
3. Non-transient failures (validation, HTTP status, bad route) are not retried
   and keep the existing ``code=beat_llm_failed`` shape.
4. ``render_turn`` carries the director's failure code into the RuntimeError so
   logs can tell "retried and still failed" from "not retryable".
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpcore
import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from agents.director import DirectorAgent
from api import routes
from db.session import Base, get_db
from main import app
from models.schemas import AgentEvent


def _plan_json() -> str:
    return json.dumps(
        [
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Jesse Pinkman",
                    "content": "All right.",
                    "emotion_state": "tense",
                    "gif_search_query": "jesse tense",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            }
        ]
    )


async def _character_reply(**_kwargs):
    return {
        "reply_text": "All right.",
        "emotion_state": "tense",
        "gif_search_query": None,
        "thinking": None,
        "action": {"verb": "idle_tense"},
    }


@pytest.fixture
def retry_director(mock_provider):
    director = DirectorAgent(provider=mock_provider)
    director.provider.resolve_model_route = MagicMock(
        return_value="stepfun/step-3.7-flash"
    )
    return director


async def _collect_beat(director) -> list[AgentEvent]:
    with patch(
        "agents.characters.base.BaseCharacter.respond_structured",
        side_effect=_character_reply,
    ):
        return [
            event
            async for event in director._generate_beat(
                task="Find a buyer",
                outline="1. The RV",
                beat_index=0,
                context={},
                language="en",
            )
        ]


# ---------------------------------------------------------------------------
# 1. One transient failure -> one bounded retry -> beat succeeds
# ---------------------------------------------------------------------------

TRANSIENT_ERRORS = [
    httpx.ReadError,
    httpcore.ReadError,
    httpx.ConnectError,
    httpcore.ConnectTimeout,
    httpx.RemoteProtocolError,
]


@pytest.mark.asyncio
@pytest.mark.parametrize("exc_type", TRANSIENT_ERRORS, ids=lambda t: t.__name__)
async def test_transient_error_is_retried_once_then_beat_succeeds(
    retry_director, monkeypatch, exc_type
):
    monkeypatch.setattr("agents.director.BEAT_TRANSIENT_RETRY_BACKOFF_SECONDS", 0.0)
    retry_director.provider.call_model = AsyncMock(
        side_effect=[exc_type("Server disconnected"), _plan_json()]
    )

    events = await _collect_beat(retry_director)

    assert retry_director.provider.call_model.await_count == 2, (
        "first transient failure must be retried exactly once inside the beat"
    )
    assert not [event for event in events if event.type == "error"]
    assert any(event.type == "agent_speak" for event in events)


# ---------------------------------------------------------------------------
# 2. Retry exhausted -> explicit failure, one bill, one refund
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_exhausted_retry_fails_with_reason_code(retry_director, monkeypatch):
    monkeypatch.setattr("agents.director.BEAT_TRANSIENT_RETRY_BACKOFF_SECONDS", 0.0)
    retry_director.provider.call_model = AsyncMock(
        side_effect=httpx.ReadError("Server disconnected")
    )

    events = await _collect_beat(retry_director)

    assert retry_director.provider.call_model.await_count == 2
    errors = [event for event in events if event.type == "error"]
    assert len(errors) == 1
    assert errors[0].data.get("code") == "beat_llm_retry_exhausted"
    assert errors[0].data.get("retryable") is True


# ---------------------------------------------------------------------------
# 3. Non-transient failures are not retried
# ---------------------------------------------------------------------------


def _http_status_error() -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://api.example.test/v1/messages")
    response = httpx.Response(401, request=request)
    return httpx.HTTPStatusError("unauthorized", request=request, response=response)


NON_TRANSIENT_ERRORS = [
    pytest.param(ValueError("Invalid model_route 'bad'"), id="ValueError"),
    pytest.param(_http_status_error(), id="HTTPStatusError"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("error", NON_TRANSIENT_ERRORS)
async def test_non_transient_error_is_not_retried(retry_director, monkeypatch, error):
    monkeypatch.setattr("agents.director.BEAT_TRANSIENT_RETRY_BACKOFF_SECONDS", 0.0)
    retry_director.provider.call_model = AsyncMock(side_effect=error)

    events = await _collect_beat(retry_director)

    assert retry_director.provider.call_model.await_count == 1, (
        "non-transient failures must fail on the first attempt"
    )
    errors = [event for event in events if event.type == "error"]
    assert len(errors) == 1
    assert errors[0].data.get("code") == "beat_llm_failed"
    assert errors[0].data.get("retryable") is False


@pytest.mark.asyncio
async def test_parse_failure_is_not_treated_as_transient(retry_director):
    """Unparseable output is a content problem: only the existing JSON repair
    call runs, never the transient transport retry."""
    retry_director.provider.call_model = AsyncMock(return_value="not json at all")

    events = await _collect_beat(retry_director)

    # One planning call + one JSON repair call (pre-existing behavior).
    assert retry_director.provider.call_model.await_count == 2
    errors = [event for event in events if event.type == "error"]
    assert errors and errors[0].data.get("code") == "beat_parse_failed"


# ---------------------------------------------------------------------------
# 4. The rejection surfaced to the caller carries the reason code
# ---------------------------------------------------------------------------


def test_rejection_error_carries_director_code():
    from story.renderer import _rejection_error

    exc = _rejection_error(
        AgentEvent(
            type="error",
            data={"code": "beat_llm_retry_exhausted", "message": "boom"},
        )
    )

    assert isinstance(exc, RuntimeError)
    assert str(exc) == "character_turn_rejected:beat_llm_retry_exhausted"


# ---------------------------------------------------------------------------
# 5. Stream level: one bill, one refund, despite the in-beat retry
# ---------------------------------------------------------------------------


@pytest.fixture
async def retry_story_api(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def database():
        async with factory() as db:
            yield db

    director = DirectorAgent(provider=MagicMock())
    director.provider.resolve_model_route = MagicMock(
        return_value="stepfun/step-3.7-flash"
    )
    director.provider.call_model = AsyncMock(
        side_effect=httpx.ReadError("Server disconnected")
    )
    director._generate_outline = AsyncMock(
        return_value="1. Opening\n2. Consequence"
    )
    director._parse_outline = MagicMock(side_effect=lambda text: text.splitlines())
    director._short_scene_name = MagicMock(return_value="desert")

    charge = AsyncMock(
        return_value=SimpleNamespace(byok=False, remaining=95, cost=5)
    )
    monkeypatch.setattr(routes, "async_session_factory", factory)
    monkeypatch.setattr(routes, "_require_platform_quota", charge)
    monkeypatch.setattr(
        "agents.director.BEAT_TRANSIENT_RETRY_BACKOFF_SECONDS", 0.0
    )
    refund = MagicMock()
    monkeypatch.setattr(routes, "_schedule_quota_refund", refund)
    overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[routes.get_director] = lambda: director
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, charge, refund, director
    app.dependency_overrides.clear()
    app.dependency_overrides.update(overrides)
    await engine.dispose()


@pytest.mark.asyncio
async def test_exhausted_retry_bills_once_and_refunds_once(retry_story_api):
    client, charge, refund, director = retry_story_api
    created = await client.post(
        "/api/session/create",
        json={
            "title": "Test",
            "task_prompt": "Original premise",
            "active_character_id": "walter",
            "scenario_id": "desert_crisis",
            "language": "en",
        },
    )
    assert created.status_code == 200, created.text
    data = created.json()
    path = f"/api/session/{data['session_id']}"
    headers = {"X-Session-Key": data["session_key"]}

    streamed = await client.get(path + "/stream", headers=headers)

    assert streamed.status_code == 200
    assert "event: error" in streamed.text
    # Bounded total: plan attempt 1 spends its 2 transport tries, then T12's
    # one regeneration spends 2 more. Still ONE billed beat, one refund.
    assert director.provider.call_model.await_count == 4
    beat_charges = [
        call for call in charge.await_args_list if call.kwargs.get("action") == "story_beat"
    ]
    assert len(beat_charges) == 1
    assert refund.call_count == 1
