"""Game Kernel unit tests — no network, no LLM, no database.

Covers the #59 acceptance contract:

1. Fixed opening + fixed 6-action sequence is a deterministic replay.
2. Action requirements / costs / effects apply.
3. Meters never leave 0..6; cash never goes negative.
4. NPCs act every turn by rule.
5. Debts trigger only when due.
6. Endings fire on turn 6 or hard-fail.
7. Same seed + same action sequence => same result.
"""

from __future__ import annotations

import copy

import pytest

from game.actions import ACTION_CATALOG, get_action, legal_actions
from game.debts import create_debt, due_debts
from game.endings import evaluate_ending
from game.events import opening_event
from game.reducer import apply_action, start_night
from game.state import METER_MAX, METER_MIN, GameState, clamp_meters


OPENING_SEED = 59
# Six legal actions that survive the opening night without an early hard fail
# for seed 59. Used for replay / determinism — not a scripted "win".
REPLAY_SEQUENCE = (
    "lie_to_skyler",
    "clean_rv",
    "pay_jesse",
    "chase_jesse",
    "call_saul",
    "stay_home",
)


def _public(state: GameState) -> dict:
    """Comparable snapshot: drop per-instance identity."""
    data = state.to_dict()
    data.pop("game_id", None)
    return data


def _play(seed: int, actions: tuple[str, ...]):
    night = start_night(seed=seed)
    state = night.state
    resolutions = []
    for action_id in actions:
        resolved = apply_action(state, action_id)
        resolutions.append(resolved)
        state = resolved.next_state
    return resolutions


# ---------------------------------------------------------------------------
# 1 + 7. Deterministic opening and replay
# ---------------------------------------------------------------------------


class TestDeterministicReplay:
    def test_fixed_opening_night(self):
        a = start_night(seed=OPENING_SEED)
        b = start_night(seed=OPENING_SEED)
        assert a.state.turn == 0
        assert a.state.ended is False
        assert a.ending is None
        assert a.event["id"] == "night_opens"
        assert a.state.police_risk == 2
        assert a.state.family_suspicion == 2
        assert a.state.jesse_trust == 3
        assert a.state.cash == 400
        assert a.state.saul_favor == 1
        assert "rv_evidence" in a.state.open_problems
        assert set(a.state.npc_state) >= {"jesse", "hank", "skyler"}
        assert _public(a.state) == _public(b.state)
        assert opening_event(a.state)["id"] == "night_opens"

    def test_same_seed_and_sequence_same_result(self):
        first = _play(OPENING_SEED, REPLAY_SEQUENCE)
        second = _play(OPENING_SEED, REPLAY_SEQUENCE)
        assert len(first) == 6
        assert len(second) == 6
        for left, right in zip(first, second):
            assert _public(left.previous_state) == _public(right.previous_state)
            assert left.action["id"] == right.action["id"]
            assert left.resolved_effects == right.resolved_effects
            assert left.npc_actions == right.npc_actions
            assert left.triggered_debts == right.triggered_debts
            assert _public(left.next_state) == _public(right.next_state)
            assert left.next_event == right.next_event
            assert left.ending == right.ending

    def test_different_seed_can_diverge_on_risk_rolls(self):
        # chase_jesse has a seeded risk roll; different seeds must be allowed
        # to produce different police_risk after the same early sequence.
        seq = ("chase_jesse",)
        results = {_play(seed, seq)[0].next_state.police_risk for seed in range(20)}
        assert len(results) >= 2


# ---------------------------------------------------------------------------
# 2. Requirements, costs, effects
# ---------------------------------------------------------------------------


class TestActionRules:
    def test_catalog_actions_are_structured(self):
        required = {
            "id",
            "label",
            "costs",
            "requirements",
            "deterministic_effects",
            "risk_profile",
            "creates_debt",
        }
        assert len(ACTION_CATALOG) >= 6
        for action in ACTION_CATALOG:
            assert required <= set(action.keys())

    def test_lie_to_skyler_lowers_suspicion_and_creates_debt(self):
        night = start_night(seed=OPENING_SEED)
        before = night.state.family_suspicion
        resolved = apply_action(night.state, "lie_to_skyler")
        assert resolved.next_state.family_suspicion == before - 1
        debt_ids = [d["id"] for d in resolved.next_state.debts]
        assert "elliott_alibi" in debt_ids
        assert any(e["field"] == "family_suspicion" for e in resolved.resolved_effects)

    def test_pay_jesse_costs_cash_and_raises_trust(self):
        night = start_night(seed=OPENING_SEED)
        resolved = apply_action(night.state, "pay_jesse")
        assert resolved.next_state.cash == 300
        assert resolved.next_state.jesse_trust == 5
        assert any(e["field"] == "cash" and e["delta"] == -100 for e in resolved.resolved_effects)

    def test_call_saul_rejected_when_broke(self):
        night = start_night(seed=OPENING_SEED)
        broke = night.state.with_updates(cash=50)
        ids = {a["id"] for a in legal_actions(broke)}
        assert "call_saul" not in ids
        with pytest.raises(ValueError, match="requirements"):
            apply_action(broke, "call_saul")

    def test_clean_rv_requires_open_problem(self):
        night = start_night(seed=OPENING_SEED)
        resolved = apply_action(night.state, "clean_rv")
        assert "rv_evidence" not in resolved.next_state.open_problems
        assert resolved.next_state.objective_state["contain_rv"] == "resolved"
        cleaned = resolved.next_state
        ids = {a["id"] for a in legal_actions(cleaned)}
        assert "clean_rv" not in ids

    def test_unknown_action_rejected(self):
        night = start_night(seed=OPENING_SEED)
        with pytest.raises(ValueError, match="unknown"):
            apply_action(night.state, "cook_product")

    def test_get_action_returns_catalog_copy(self):
        action = get_action("stay_home")
        action["label"] = "mutated"
        assert get_action("stay_home")["label"] != "mutated"


# ---------------------------------------------------------------------------
# 3. Bounds
# ---------------------------------------------------------------------------


class TestBounds:
    def test_clamp_meters(self):
        raw = GameState.new(seed=1, game_id="t")
        raw.police_risk = 99
        raw.family_suspicion = -4
        raw.jesse_trust = 12
        raw.cash = -80
        clamped = clamp_meters(raw)
        assert clamped.police_risk == METER_MAX
        assert clamped.family_suspicion == METER_MIN
        assert clamped.jesse_trust == METER_MAX
        assert clamped.cash == 0

    def test_repeated_confront_never_exceeds_meter_max(self):
        state = start_night(seed=OPENING_SEED).state
        last_risk = state.police_risk
        for _ in range(8):
            if state.ended:
                break
            if "confront_hank" not in {a["id"] for a in legal_actions(state)}:
                break
            resolved = apply_action(state, "confront_hank")
            state = resolved.next_state
            assert METER_MIN <= state.police_risk <= METER_MAX
            last_risk = state.police_risk
        assert last_risk <= METER_MAX


# ---------------------------------------------------------------------------
# 4. NPC rules
# ---------------------------------------------------------------------------


class TestNpcRules:
    def test_every_turn_npcs_act(self):
        night = start_night(seed=OPENING_SEED)
        resolved = apply_action(night.state, "stay_home")
        actors = {row["npc_id"] for row in resolved.npc_actions}
        assert actors >= {"jesse", "hank", "skyler"}
        for row in resolved.npc_actions:
            assert row["action_id"]
            assert row["summary"]

    def test_low_trust_jesse_panics(self):
        night = start_night(seed=OPENING_SEED)
        # stay_home costs 1 trust. Start at 2 so the NPC still sees "low, not gone".
        shaky = night.state.with_updates(jesse_trust=2)
        resolved = apply_action(shaky, "stay_home")
        jesse = next(row for row in resolved.npc_actions if row["npc_id"] == "jesse")
        assert jesse["action_id"] == "panic"
        assert resolved.next_state.jesse_trust == 1
        assert resolved.next_state.npc_state["jesse"]["mood"] == "panicked"


# ---------------------------------------------------------------------------
# 5. Debt triggers only when due
# ---------------------------------------------------------------------------


class TestDebtTriggers:
    def test_elliott_alibi_does_not_fire_on_creation_turn(self):
        night = start_night(seed=OPENING_SEED)
        resolved = apply_action(night.state, "lie_to_skyler")
        assert resolved.triggered_debts == []
        assert any(d["id"] == "elliott_alibi" for d in resolved.next_state.debts)

    def test_elliott_alibi_returns_on_a_later_turn(self):
        night = start_night(seed=OPENING_SEED)
        # Turn 0: plant the lie. Debt countdown starts at 2 and does not tick
        # on the creation turn.
        planted = apply_action(night.state, "lie_to_skyler")
        assert planted.triggered_debts == []
        # Turn 1: countdown 2 -> 1, still not due.
        mid = apply_action(planted.next_state, "clean_rv")
        assert mid.triggered_debts == []
        alibi = next(d for d in mid.next_state.debts if d["id"] == "elliott_alibi")
        assert alibi["countdown"] == 1
        # Turn 2: countdown 1 -> 0, now due.
        later = apply_action(mid.next_state, "pay_jesse")
        ids = [d["id"] for d in later.triggered_debts]
        assert "elliott_alibi" in ids
        assert later.next_state.family_suspicion > mid.next_state.family_suspicion
        assert later.next_state.police_risk > mid.next_state.police_risk
        remaining = [d["id"] for d in later.next_state.debts]
        assert "elliott_alibi" not in remaining

    def test_due_helper_ignores_future_debts(self):
        debt = create_debt("elliott_alibi", source_action="lie_to_skyler", countdown=2)
        state = start_night(seed=OPENING_SEED).state
        state.debts = [debt]
        assert due_debts(state) == []
        state.debts[0]["countdown"] = 0
        assert [d["id"] for d in due_debts(state)] == ["elliott_alibi"]


# ---------------------------------------------------------------------------
# 6. Endings
# ---------------------------------------------------------------------------


class TestEndings:
    def test_hard_fail_cuffed_when_police_maxed(self):
        state = start_night(seed=OPENING_SEED).state.with_updates(police_risk=6)
        ending = evaluate_ending(state)
        assert ending is not None
        assert ending["kind"] == "loss"
        assert ending["id"] == "cuffed"

    def test_hard_fail_family_gone(self):
        state = start_night(seed=OPENING_SEED).state.with_updates(family_suspicion=6)
        ending = evaluate_ending(state)
        assert ending["id"] == "family_gone"

    def test_hard_fail_snitch(self):
        state = start_night(seed=OPENING_SEED).state
        state.flags.add("jesse_talked")
        ending = evaluate_ending(state)
        assert ending["id"] == "snitch"

    def test_no_ending_mid_night_if_meters_hold(self):
        state = start_night(seed=OPENING_SEED).state
        assert evaluate_ending(state) is None

    def test_sixth_turn_always_ends(self):
        resolutions = _play(OPENING_SEED, REPLAY_SEQUENCE)
        assert len(resolutions) == 6
        last = resolutions[-1]
        assert last.next_state.turn == 6
        assert last.next_state.ended is True
        assert last.ending is not None
        assert last.ending["kind"] in {"win", "loss", "cost"}
        assert last.ending["id"] in {"contained", "pyrrhic", "ticking", "cuffed", "family_gone", "snitch"}

    def test_action_rejected_after_ending(self):
        resolutions = _play(OPENING_SEED, REPLAY_SEQUENCE)
        with pytest.raises(ValueError, match="ended"):
            apply_action(resolutions[-1].next_state, "stay_home")

    def test_constructed_win_and_cost_endings(self):
        win = start_night(seed=OPENING_SEED).state.with_updates(
            turn=6,
            police_risk=2,
            family_suspicion=2,
            jesse_trust=4,
            open_problems=["hank_voicemail"],
            debts=[],
        )
        win.objective_state["contain_rv"] = "resolved"
        assert evaluate_ending(win)["id"] == "contained"
        assert evaluate_ending(win)["kind"] == "win"

        ticking = copy.deepcopy(win)
        ticking.open_problems = ["rv_evidence", "hank_voicemail"]
        ticking.objective_state["contain_rv"] = "open"
        assert evaluate_ending(ticking)["id"] == "ticking"
        assert evaluate_ending(ticking)["kind"] == "cost"

        pyrrhic = copy.deepcopy(win)
        pyrrhic.debts = [create_debt("saul_marker", source_action="call_saul", countdown=1)]
        assert evaluate_ending(pyrrhic)["id"] == "pyrrhic"
        assert evaluate_ending(pyrrhic)["kind"] == "cost"


class TestResolvedBeatShape:
    def test_action_returns_settlement_contract(self):
        night = start_night(seed=OPENING_SEED)
        resolved = apply_action(night.state, "chase_jesse")
        payload = resolved.to_dict()
        for key in (
            "previous_state",
            "action",
            "resolved_effects",
            "npc_actions",
            "triggered_debts",
            "next_state",
            "next_event",
            "ending",
        ):
            assert key in payload
        beat = resolved.resolved_beat()
        assert beat["player_action"]["id"] == "chase_jesse"
        assert "visible_state" in beat
        assert "police_risk" in beat["visible_state"]
