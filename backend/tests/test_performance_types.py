# Given a settled night action
# When performance types are constructed
# Then request/result carry revision and settlement, and never a resource grant

from __future__ import annotations

from game.kernel import apply_action, player_view, start_run
from game.performance_types import PerformanceRequest, PerformanceResult
from agents.performance import request_from_player_view


def test_request_and_result_fields_are_the_contract():
    req_fields = set(PerformanceRequest.__dataclass_fields__)
    res_fields = set(PerformanceResult.__dataclass_fields__)
    for name in (
        "run_id",
        "action_id",
        "revision",
        "choice_id",
        "speaker",
        "player_is_walter",
        "settled_facts",
        "visible_facts",
        "fallback_line",
        "player_confirmed_intent",
        "open_promises",
        "resources",
    ):
        assert name in req_fields
    for name in (
        "job_id",
        "run_id",
        "action_id",
        "revision",
        "status",
        "line",
        "used_fallback",
        "reason",
        "resources_awarded",
        "invented_commitments",
    ):
        assert name in res_fields


def test_request_from_player_view_copies_settlement_not_blank():
    state = start_run(seed=3)
    nxt, err = apply_action(state, "listen_jesse")
    assert err is None
    view = player_view(nxt)
    req = request_from_player_view(
        view,
        action_id="act-1",
        choice_id="listen_jesse",
    )
    assert req.run_id == view["run_id"]
    assert req.revision == view["revision"]
    assert req.action_id == "act-1"
    assert req.resources == view["resources"]
    assert req.player_is_walter is True
    assert req.fallback_line
    assert "hot_bag" in req.settled_facts or any("包" in f for f in req.settled_facts)
    assert req.resources["cash"] == view["resources"]["cash"]
