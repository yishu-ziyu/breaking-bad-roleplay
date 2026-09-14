# Given a kitchen night: Walter promised Skyler he'd come home, Jesse is at the door.
# When the player takes structured actions with costs
# Then the kernel settles resources, NPC moves, overdue promises, and an ending
# without calling an LLM or touching a database.
from __future__ import annotations

import copy
import json

from game.kernel import apply_action, fingerprint, player_view, start_run

FAMILY_FIRST = ["go_home", "call_jesse", "stall", "stall", "stall", "stall"]
LISTEN_FIRST = ["listen_jesse", "stash_the_bag", "go_home", "stall", "stall", "stall"]
SAUL_DELAY = ["call_saul", "listen_jesse", "stash_the_bag", "go_home", "stall", "stall"]


def _play(actions: list[str], seed: int = 7):
    state = start_run(seed=seed)
    errors: list[str] = []
    for action_id in actions:
        state, err = apply_action(state, action_id)
        if err:
            errors.append(f"{action_id}: {err}")
    return state, errors


def test_g1_same_seed_and_actions_are_deterministic():
    a, err_a = _play(LISTEN_FIRST, seed=11)
    b, err_b = _play(LISTEN_FIRST, seed=11)
    assert err_a == []
    assert err_b == []
    assert fingerprint(a) == fingerprint(b)
    assert a.ending is not None
    assert a.turn == 7


def test_g2_illegal_action_does_not_mutate_state():
    state = start_run(seed=3)
    before = fingerprint(state)
    nxt, err = apply_action(state, "teleport_to_mexico")
    assert err
    assert fingerprint(nxt) == before
    assert nxt.turn == 1
    listen = next(a for a in player_view(state)["legal_actions"] if a["id"] == "listen_jesse")
    assert listen["cost_text"]
    assert "消耗" in listen["cost_text"] or "放弃" in listen["cost_text"] or "人情" in listen["cost_text"]


def test_g2_action_requirements_and_effects_apply():
    state = start_run(seed=3)
    assert state.resources["saul_favor"] == 1
    state, err = apply_action(state, "call_saul")
    assert err is None
    assert state.resources["saul_favor"] == 0
    state2, err2 = apply_action(state, "call_saul")
    assert err2
    assert state2.resources["saul_favor"] == 0


def test_g3_npc_acts_when_jesse_is_left_alone():
    state = start_run(seed=3)
    state, err = apply_action(state, "go_home")
    assert err is None
    npc_lines = [e for e in state.log if e.get("source") == "npc"]
    assert npc_lines, "waiting or walking away must not freeze Jesse"
    assert any("杰西" in (e.get("text") or "") for e in npc_lines)


def test_g3_early_promise_returns_with_source():
    state = start_run(seed=3)
    # Stay in the kitchen without going home. After the third action, turn 4
    # is due for the opening promise.
    for action_id in ("listen_jesse", "stash_the_bag", "stash_the_bag"):
        state, err = apply_action(state, action_id)
        assert err is None, err
    triggered = [e for e in state.log if e.get("source") == "promise"]
    assert triggered
    blob = " ".join(e.get("text") or "" for e in triggered)
    assert "回家" in blob
    assert "答应" in blob


def test_g4_three_strategies_reach_different_endings():
    family, err_f = _play(FAMILY_FIRST)
    listen, err_l = _play(LISTEN_FIRST)
    saul, err_s = _play(SAUL_DELAY)
    assert err_f == err_l == err_s == []
    ids = {family.ending["id"], listen.ending["id"], saul.ending["id"]}
    assert len(ids) == 3
    assert family.ending["id"] == "family_over_jesse"
    assert listen.ending["id"] == "held_the_line"
    assert saul.ending["id"] == "bought_time"
    for run in (family, listen, saul):
        causes = run.ending["causes"]
        assert causes
        assert all(c.get("action_id") for c in causes)
        keys = [(c["turn"], c["action_id"]) for c in listen.ending["causes"]]
        assert keys == list(dict.fromkeys(keys))
        assert [c["turn"] for c in listen.ending["causes"]] == [1, 2, 3, 4, 5, 6]


def test_meters_clamp_and_kernel_has_no_provider():
    import game.kernel as kernel_mod
    src = kernel_mod.__file__
    text = open(src, encoding="utf-8").read()
    assert "ProviderFacade" not in text
    assert "call_model" not in text
    state = start_run(seed=1)
    # Direct mutation is test-only to prove the clamp on the next legal apply.
    hot = copy.deepcopy(state)
    hot.meters["police_risk"] = 6
    hot.meters["family_strain"] = 6
    nxt, err = apply_action(hot, "listen_jesse")
    assert err is None, err
    assert 0 <= nxt.meters["police_risk"] <= 6
    assert 0 <= nxt.meters["family_strain"] <= 6


def test_player_view_hides_unresolved_future_and_names_the_board():
    view = player_view(start_run(seed=1))
    assert view["player"] == "沃尔特"
    assert view["turn"] == 1
    assert view["turns_max"] == 6
    assert "objective" in view
    assert len(view["legal_actions"]) >= 2
    assert len(view["legal_actions"]) <= 3
    assert "ending" in view
    assert view["ending"] is None


def test_player_view_history_lists_six_actions_with_costs():
    state, errors = _play(LISTEN_FIRST, seed=11)
    assert errors == []
    view = player_view(state)
    players = [item for item in view["history"] if item.get("source") == "player"]
    assert [item["action_id"] for item in players] == LISTEN_FIRST
    assert all(item.get("label") for item in players)
    assert all(item.get("cost_text") for item in players)
    blob = json.dumps(view["history"], ensure_ascii=False)
    assert "内心" not in blob
    assert "npc_intent" not in blob
    assert [c["action_id"] for c in view["ending"]["causes"]] == LISTEN_FIRST
