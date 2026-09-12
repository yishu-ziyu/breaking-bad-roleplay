"""Debt lifecycle. Trigger rules live here; only the reducer writes state."""

from __future__ import annotations

from typing import Any
import copy

from game.state import GameState

DEBT_CATALOG: dict[str, dict[str, Any]] = {
    "elliott_alibi": {
        "id": "elliott_alibi",
        "severity": 2,
        "countdown": 2,
        "exposed_to": ["skyler", "hank"],
        "summary": "The Elliott story. It holds until someone who knows Elliott asks.",
        "consequence": [
            {"field": "family_suspicion", "delta": 2},
            {"field": "police_risk", "delta": 1},
            {"field": "flags", "add": "alibi_collapsed"},
        ],
    },
    "saul_marker": {
        "id": "saul_marker",
        "severity": 1,
        "countdown": 3,
        "exposed_to": ["saul"],
        "summary": "Saul will call the marker. Cash if you have it; heat if you don't.",
        "consequence": [],  # filled at trigger from current cash
    },
    "jesse_abandoned": {
        "id": "jesse_abandoned",
        "severity": 2,
        "countdown": 99,
        "exposed_to": ["jesse"],
        "summary": "You left him in the desert while he was coming apart.",
        "consequence": [
            {"field": "jesse_trust", "delta": -2},
            {"field": "police_risk", "delta": 1},
            {"field": "flags", "add": "jesse_going_to_talk"},
        ],
    },
}


def create_debt(debt_id: str, *, source_action: str, countdown: int | None = None) -> dict[str, Any]:
    spec = DEBT_CATALOG.get(debt_id)
    if spec is None:
        raise ValueError(f"unknown debt: {debt_id}")
    debt = copy.deepcopy(spec)
    debt["source_action"] = source_action
    debt["countdown"] = spec["countdown"] if countdown is None else countdown
    return debt


def _hank_heat(state: GameState) -> int:
    return int((state.npc_state.get("hank") or {}).get("heat") or 0)


def is_due(state: GameState, debt: dict[str, Any]) -> bool:
    debt_id = debt["id"]
    countdown = int(debt.get("countdown") or 0)
    if debt_id == "elliott_alibi":
        return countdown <= 0 or _hank_heat(state) >= 3 or "hank_at_door" in state.flags
    if debt_id == "saul_marker":
        return countdown <= 0
    if debt_id == "jesse_abandoned":
        return state.turn >= 4 and state.jesse_trust <= 2
    return countdown <= 0


def due_debts(state: GameState) -> list[dict[str, Any]]:
    return [copy.deepcopy(d) for d in state.debts if is_due(state, d)]


def tick_debts(state: GameState) -> list[dict[str, Any]]:
    """Decrement countdowns. Skip debts created this turn (fresh)."""
    ticked: list[dict[str, Any]] = []
    for debt in state.debts:
        row = copy.deepcopy(debt)
        if row.get("fresh"):
            row["fresh"] = False
        else:
            row["countdown"] = max(0, int(row.get("countdown") or 0) - 1)
        ticked.append(row)
    return ticked


def consequence_effects(state: GameState, debt: dict[str, Any]) -> list[dict[str, Any]]:
    source = f"debt:{debt['id']}"
    if debt["id"] == "saul_marker":
        if state.cash >= 100:
            return [{"field": "cash", "delta": -100, "source": source}]
        return [
            {"field": "police_risk", "delta": 1, "source": source},
            {"field": "saul_favor", "delta": -1, "source": source},
        ]
    spec = DEBT_CATALOG[debt["id"]]
    effects = []
    for effect in spec["consequence"]:
        row = copy.deepcopy(effect)
        row["source"] = source
        effects.append(row)
    return effects
