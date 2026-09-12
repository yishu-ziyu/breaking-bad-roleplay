"""The only GameState writer.

Order: validate → player resolve → NPC → tick/trigger debts → turn++ → ending → event.
AI performance is not called from here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import random

from game.actions import get_action, legal_actions, meets_requirements, player_effects
from game.debts import consequence_effects, create_debt, due_debts, tick_debts
from game.endings import evaluate_ending
from game.events import next_event, opening_event, template_performance
from game.npc import plan_npc_actions
from game.state import MAX_TURNS, GameState, clamp_meters


@dataclass
class ResolvedTurn:
    previous_state: GameState
    action: dict[str, Any]
    resolved_effects: list[dict[str, Any]]
    npc_actions: list[dict[str, Any]]
    triggered_debts: list[dict[str, Any]]
    next_state: GameState
    next_event: dict[str, Any]
    ending: dict[str, Any] | None
    available_actions: list[dict[str, Any]] = field(default_factory=list)

    def resolved_beat(self) -> dict[str, Any]:
        return {
            "event": self.next_event,
            "player_action": {
                "id": self.action["id"],
                "label": self.action.get("label"),
                "costs": self.action.get("costs") or {},
            },
            "resolved_effects": list(self.resolved_effects),
            "npc_action": list(self.npc_actions),
            "npc_actions": list(self.npc_actions),
            "triggered_debts": list(self.triggered_debts),
            "visible_state": self.next_state.visible(),
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "previous_state": self.previous_state.to_dict(),
            "action": self.action,
            "resolved_effects": list(self.resolved_effects),
            "npc_actions": list(self.npc_actions),
            "triggered_debts": list(self.triggered_debts),
            "next_state": self.next_state.to_dict(),
            "next_event": self.next_event,
            "ending": self.ending,
            "available_actions": list(self.available_actions),
            "resolved_beat": self.resolved_beat(),
            "performance": template_performance(self.resolved_beat()),
        }


@dataclass
class NightStart:
    state: GameState
    event: dict[str, Any]
    available_actions: list[dict[str, Any]]
    ending: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "game_id": self.state.game_id,
            "state": self.state.to_dict(),
            "event": self.event,
            "available_actions": list(self.available_actions),
            "ending": self.ending,
            "performance": template_performance(
                {
                    "player_action": {"id": "opening"},
                    "visible_state": self.state.visible(),
                }
            ),
        }


def start_night(seed: int, game_id: str | None = None) -> NightStart:
    state = clamp_meters(GameState.new(seed=seed, game_id=game_id))
    return NightStart(
        state=state,
        event=opening_event(state),
        available_actions=legal_actions(state),
        ending=None,
    )


def _draw(state: GameState) -> float:
    rng = random.Random(state.seed + 1009 * state.rng_counter + 17)
    state.rng_counter += 1
    return rng.random()


def _apply_effects(state: GameState, effects: list[dict[str, Any]]) -> GameState:
    nxt = state.clone()
    for effect in effects:
        field = effect.get("field")
        if field in {"police_risk", "family_suspicion", "jesse_trust", "cash", "saul_favor"}:
            setattr(nxt, field, getattr(nxt, field) + int(effect.get("delta") or 0))
        elif field == "open_problems" and effect.get("remove"):
            nxt.open_problems = [p for p in nxt.open_problems if p != effect["remove"]]
        elif field == "objective_state":
            nxt.objective_state[str(effect["key"])] = str(effect["value"])
        elif field == "flags" and effect.get("add"):
            nxt.flags.add(str(effect["add"]))
        elif field == "npc_jesse_mood":
            nxt.npc_state.setdefault("jesse", {})["mood"] = effect["value"]
        elif field == "npc_hank_heat":
            hank = nxt.npc_state.setdefault("hank", {})
            if "value" in effect:
                hank["heat"] = int(effect["value"])
            else:
                hank["heat"] = int(hank.get("heat") or 0) + int(effect.get("delta") or 0)
        elif field == "npc_skyler_asking":
            nxt.npc_state.setdefault("skyler", {})["asking"] = bool(effect["value"])
        elif field == "create_debt":
            debt_id = str(effect["debt_id"])
            if not any(d["id"] == debt_id for d in nxt.debts):
                debt = create_debt(debt_id, source_action=str(effect.get("source") or "unknown"))
                debt["fresh"] = True
                nxt.debts.append(debt)
    return clamp_meters(nxt)


def apply_action(state: GameState, action_id: str) -> ResolvedTurn:
    if state.ended:
        raise ValueError("game already ended")
    try:
        action = get_action(action_id)
    except ValueError as exc:
        raise ValueError(f"unknown action: {action_id}") from exc
    if not meets_requirements(state, action):
        raise ValueError(f"action requirements not met: {action_id}")

    previous = state.clone()
    working = state.clone()
    roll = _draw(working)
    player_fx = player_effects(previous, action, roll)

    if action.get("creates_debt"):
        player_fx.append(
            {
                "field": "create_debt",
                "debt_id": action["creates_debt"],
                "source": action["id"],
            }
        )

    working = _apply_effects(working, player_fx)

    npc_actions = plan_npc_actions(working)
    npc_fx: list[dict[str, Any]] = []
    for row in npc_actions:
        npc_fx.extend(row.get("effects") or [])
    working = _apply_effects(working, npc_fx)

    working.debts = tick_debts(working)
    triggered = due_debts(working)
    debt_fx: list[dict[str, Any]] = []
    for debt in triggered:
        debt_fx.extend(consequence_effects(working, debt))
    working = _apply_effects(working, debt_fx)
    if triggered:
        triggered_ids = {d["id"] for d in triggered}
        working.debts = [d for d in working.debts if d["id"] not in triggered_ids]

    working.turn = previous.turn + 1
    if working.turn > MAX_TURNS:
        working.turn = MAX_TURNS

    ending = evaluate_ending(working)
    if ending is not None:
        working.ended = True
        working.ending = ending

    event = next_event(working, triggered=triggered, npc_actions=npc_actions)
    resolved_effects = player_fx + npc_fx + debt_fx

    return ResolvedTurn(
        previous_state=previous,
        action=action,
        resolved_effects=resolved_effects,
        npc_actions=npc_actions,
        triggered_debts=triggered,
        next_state=working,
        next_event=event,
        ending=ending,
        available_actions=legal_actions(working),
    )
