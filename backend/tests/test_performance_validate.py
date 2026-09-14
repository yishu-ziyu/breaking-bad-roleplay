# Given a settled beat and a mocked provider
# When the model awards resources, invents a Walter promise, or voices a fact that did not happen
# Then validation fails to fallback and settlement is unchanged

from __future__ import annotations

import copy
from unittest.mock import AsyncMock, MagicMock

from agents.performance import enqueue_performance, fulfill_performance, request_from_player_view
from game.kernel import apply_action, player_view, start_run
from game.performance_types import PerformanceRequest

HIDDEN = (
    "The cook partnership operates under Gus Fring's organization and standards."
)


def _listen_request() -> tuple[PerformanceRequest, dict]:
    state = start_run(seed=3)
    nxt, err = apply_action(state, "listen_jesse")
    assert err is None
    view = player_view(nxt)
    run = {
        "revision": view["revision"],
        "resources": dict(view["resources"]),
        "promises": [p["id"] for p in nxt.promises if not p.get("resolved")],
    }
    req = request_from_player_view(
        view,
        action_id="act-listen",
        choice_id="listen_jesse",
        hidden_facts=(HIDDEN,),
    )
    return req, run


def _provider(text: str):
    provider = MagicMock()
    provider.call_model = AsyncMock(return_value=text)
    return provider


async def _fulfill(text: str):
    req, run = _listen_request()
    before = copy.deepcopy(run)
    job = enqueue_performance(req.run_id, req.action_id, req.revision, req)
    result = await fulfill_performance(job, _provider(text))
    return result, before, run, req


async def test_resource_award_in_payload_is_rejected():
    result, before, run, req = await _fulfill(
        '{"speaker":"jesse","line":"包还在。","resources":{"cash":5}}'
    )
    assert result.used_fallback is True
    assert result.resources_awarded == {}
    assert result.revision == req.revision
    assert run == before


async def test_resource_award_spoken_in_line_is_rejected():
    result, before, run, req = await _fulfill(
        '{"speaker":"jesse","line":"现金到账了，人情也回来了。"}'
    )
    assert result.used_fallback is True
    assert result.resources_awarded == {}
    assert run["resources"] == before["resources"]


async def test_revision_in_payload_cannot_change_settlement():
    result, before, run, req = await _fulfill(
        '{"speaker":"jesse","line":"包是烫的。","revision":99}'
    )
    assert result.used_fallback is True
    assert result.revision == req.revision == before["revision"]
    assert run["revision"] == before["revision"]


async def test_invented_walter_commitment_is_rejected():
    result, before, run, req = await _fulfill(
        '{"speaker":"jesse","line":"好，沃尔特答应今晚把包留给杰西，不回家。"}'
    )
    assert result.used_fallback is True
    assert result.invented_commitments == ()
    assert run["promises"] == before["promises"]
    assert "home_tonight" in run["promises"]


async def test_walter_line_must_not_accept_a_new_promise():
    result, before, run, req = await _fulfill(
        '{"speaker":"walter","line":"好，我答应你今晚留下，不回家。"}'
    )
    assert result.used_fallback is True
    assert result.revision == req.revision
    assert run == before


async def test_hidden_fact_that_speaker_does_not_know_is_rejected():
    result, before, run, _req = await _fulfill(
        '{"speaker":"jesse","line":"I know the cook partnership operates under Gus Fring\'s organization and standards."}'
    )
    assert result.used_fallback is True
    assert run == before


async def test_invented_event_that_did_not_happen_is_rejected():
    result, before, run, _req = await _fulfill(
        '{"speaker":"jesse","line":"汉克已经带着搜查令破门而入，DEA 在院子里。"}'
    )
    assert result.used_fallback is True
    assert run == before


async def test_existing_home_promise_may_be_voiced():
    result, before, run, req = await _fulfill(
        '{"speaker":"jesse","line":"你答应过斯凯勒今晚回家。盘子还在桌上。"}'
    )
    assert result.used_fallback is False
    assert result.status == "ready"
    assert "回家" in result.line
    assert run == before
    assert result.revision == req.revision
