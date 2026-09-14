# Given kernel settlement already happened
# When the provider times out, 429s, or returns garbage
# Then a fallback line is used and run resources / revision / promises stay put

from __future__ import annotations

import asyncio
import copy
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from agents.performance import enqueue_performance, fulfill_performance
from game.kernel import apply_action, player_view, start_run
from game.performance_types import PerformanceRequest
from game.store import MemoryGameStore


HIDDEN = (
    "The cook partnership operates under Gus Fring's organization and standards."
)


def _settled_request(**overrides) -> tuple[PerformanceRequest, dict]:
    state = start_run(seed=3)
    nxt, err = apply_action(state, "listen_jesse")
    assert err is None
    view = player_view(nxt)
    run = {
        "revision": view["revision"],
        "resources": dict(view["resources"]),
        "promises": copy.deepcopy(nxt.promises),
        "meters": dict(view["meters"]),
    }
    from agents.performance import request_from_player_view

    req = request_from_player_view(
        view,
        action_id="act-listen",
        choice_id="listen_jesse",
        hidden_facts=(HIDDEN,),
    )
    if overrides:
        payload = {**req.__dict__, **overrides}
        req = PerformanceRequest(**payload)
    return req, run


def _provider(side_effect=None, return_value=None):
    provider = MagicMock()
    if side_effect is not None:
        provider.call_model = AsyncMock(side_effect=side_effect)
    else:
        provider.call_model = AsyncMock(return_value=return_value)
    return provider


def _http_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://example.test/v1")
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError("provider", request=request, response=response)


def test_enqueue_writes_pending_job_and_does_not_touch_run():
    req, run = _settled_request()
    before = copy.deepcopy(run)
    store = MemoryGameStore()
    job = enqueue_performance(req.run_id, req.action_id, req.revision, req, sink=store)
    assert job.status == "pending"
    assert job.revision == req.revision
    assert store.get_job(job.id)["status"] == "pending"
    assert run == before
    assert job.request.resources == before["resources"]


@pytest.mark.parametrize(
    "side_effect,reason_part",
    [
        (asyncio.TimeoutError(), "timeout"),
        (_http_error(429), "429"),
        (RuntimeError("provider down"), "provider"),
    ],
)
async def test_a1_provider_fail_uses_fallback_without_rollback(side_effect, reason_part):
    req, run = _settled_request()
    before = copy.deepcopy(run)
    job = enqueue_performance(req.run_id, req.action_id, req.revision, req)
    result = await fulfill_performance(job, _provider(side_effect=side_effect), timeout_s=0.05)
    assert result.used_fallback is True
    assert result.status == "fallback"
    assert result.line == req.fallback_line
    assert result.revision == before["revision"] == req.revision
    assert result.resources_awarded == {}
    assert result.invented_commitments == ()
    assert reason_part in (result.reason or "")
    assert run == before
    assert job.request.resources == before["resources"]


async def test_a1_timeout_from_slow_call():
    req, run = _settled_request()
    before = copy.deepcopy(run)

    async def slow(*_a, **_k):
        await asyncio.sleep(1)
        return '{"line":"too late"}'

    job = enqueue_performance(req.run_id, req.action_id, req.revision, req)
    result = await fulfill_performance(job, _provider(side_effect=slow), timeout_s=0.05)
    assert result.used_fallback is True
    assert result.line == req.fallback_line
    assert run == before


async def test_a1_format_error_falls_back():
    req, run = _settled_request()
    before = copy.deepcopy(run)
    job = enqueue_performance(req.run_id, req.action_id, req.revision, req)
    result = await fulfill_performance(
        job,
        _provider(return_value='{"revision": 99, "resources": {"cash": 9}, "line":}'),
    )
    assert result.used_fallback is True
    assert result.revision == req.revision
    assert result.resources_awarded == {}
    assert run == before


async def test_valid_line_is_ready_and_still_does_not_grant_resources():
    req, run = _settled_request()
    before = copy.deepcopy(run)
    job = enqueue_performance(req.run_id, req.action_id, req.revision, req)
    result = await fulfill_performance(
        job,
        _provider(return_value='{"speaker":"jesse","line":"包是烫的。你今晚别把门关上。"}'),
    )
    assert result.used_fallback is False
    assert result.status == "ready"
    assert "烫" in result.line or "门" in result.line
    assert result.revision == req.revision
    assert result.resources_awarded == {}
    assert run == before
