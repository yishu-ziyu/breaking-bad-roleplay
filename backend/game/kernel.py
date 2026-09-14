"""Deterministic six-turn night kernel. No LLM, no database."""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def _load_scenario() -> dict[str, Any]:
    here = Path(__file__).resolve()
    candidates = (
        here.parents[2] / "src" / "features" / "game" / "one_night.json",
        here.parent / "data" / "one_night.json",
    )
    for path in candidates:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    raise FileNotFoundError("one_night.json")


SCENARIO = _load_scenario()
TURNS = int(SCENARIO["turns"])
METER_BOUNDS = {
    name: (int(spec["min"]), int(spec["max"])) for name, spec in SCENARIO["meters"].items()
}


def _clamp_meter(name: str, value: int) -> int:
    lo, hi = METER_BOUNDS[name]
    return max(lo, min(hi, value))


@dataclass
class GameState:
    run_id: str
    seed: int
    revision: int
    turn: int
    meters: dict[str, int]
    resources: dict[str, int]
    location: str
    flags: dict[str, Any]
    known: list[str]
    promises: list[dict[str, Any]]
    fired_npc: list[str]
    log: list[dict[str, Any]]
    scene: dict[str, str]
    last_consequence: str
    ending: dict[str, Any] | None = None
    last_actions: list[dict[str, Any]] = field(default_factory=list)


def start_run(seed: int = 1, run_id: str | None = None) -> GameState:
    meters = {name: int(spec["start"]) for name, spec in SCENARIO["meters"].items()}
    resources = {name: int(spec["start"]) for name, spec in SCENARIO["resources"].items()}
    return GameState(
        run_id=run_id or f"night-{seed}",
        seed=seed,
        revision=0,
        turn=1,
        meters=meters,
        resources=resources,
        location=str(SCENARIO["location_start"]),
        flags=copy.deepcopy(SCENARIO["flags_start"]),
        known=[],
        promises=copy.deepcopy(SCENARIO["promises_start"]),
        fired_npc=[],
        log=[],
        scene=copy.deepcopy(SCENARIO["opening_scene"]),
        last_consequence="",
        ending=None,
        last_actions=[],
    )


def fingerprint(state: GameState) -> str:
    payload = {
        "seed": state.seed,
        "revision": state.revision,
        "turn": state.turn,
        "meters": state.meters,
        "resources": state.resources,
        "location": state.location,
        "flags": state.flags,
        "known": state.known,
        "promises": state.promises,
        "fired_npc": state.fired_npc,
        "log": state.log,
        "ending": state.ending,
    }
    blob = json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _flag_value(state: GameState, key: str) -> Any:
    return state.flags.get(key)


def _promise(state: GameState, pid: str) -> dict[str, Any] | None:
    for item in state.promises:
        if item.get("id") == pid:
            return item
    return None


def _promise_open(state: GameState, pid: str) -> bool:
    found = _promise(state, pid)
    return bool(found) and not found.get("resolved")


def matches(when: dict[str, Any] | None, state: GameState) -> bool:
    if not when:
        return True
    flag_eq = when.get("flag_eq") or {}
    for key, expected in flag_eq.items():
        if _flag_value(state, key) != expected:
            return False
    flag_in = when.get("flag_in") or {}
    for key, options in flag_in.items():
        if _flag_value(state, key) not in options:
            return False
    resource_gte = when.get("resource_gte") or {}
    for key, minimum in resource_gte.items():
        if int(state.resources.get(key, 0)) < int(minimum):
            return False
    known = when.get("known") or []
    for fact in known:
        if fact not in state.known:
            return False
    if "location" in when and state.location != when["location"]:
        return False
    if "promise_open" in when and not _promise_open(state, when["promise_open"]):
        return False
    if "promise_missing" in when and _promise_open(state, when["promise_missing"]):
        return False
    if "promise_resolved" in when:
        found = _promise(state, when["promise_resolved"])
        if not found or not found.get("resolved"):
            return False
    meter_gte = when.get("meter_gte") or {}
    for key, minimum in meter_gte.items():
        if int(state.meters.get(key, 0)) < int(minimum):
            return False
    meter_lte = when.get("meter_lte") or {}
    for key, maximum in meter_lte.items():
        if int(state.meters.get(key, 0)) > int(maximum):
            return False
    return True


def _legal_defs(state: GameState) -> list[dict[str, Any]]:
    matched = [a for a in SCENARIO["actions"] if matches(a.get("when"), state)]
    if len(matched) <= 3:
        return matched
    without = [a for a in matched if a["id"] != "stall"]
    if len(without) >= 3:
        return without[:3]
    stall = [a for a in matched if a["id"] == "stall"]
    return (without + stall)[:3]


def _append_log(
    state: GameState,
    *,
    source: str,
    text: str,
    action_id: str | None = None,
    label: str = "",
    acted_on_turn: int | None = None,
) -> None:
    if not text:
        return
    state.log.append(
        {
            "source": source,
            "text": text,
            "action_id": action_id,
            "label": label,
            "turn": acted_on_turn if acted_on_turn is not None else state.turn,
        }
    )


def _apply_effects(
    state: GameState,
    effects: dict[str, Any] | None,
    *,
    source: str,
    action_id: str | None = None,
    label: str = "",
    acted_on_turn: int | None = None,
) -> None:
    if not effects:
        return
    for name, delta in (effects.get("meters") or {}).items():
        state.meters[name] = _clamp_meter(name, int(state.meters.get(name, 0)) + int(delta))
    for name, delta in (effects.get("resources") or {}).items():
        nxt = int(state.resources.get(name, 0)) + int(delta)
        state.resources[name] = max(0, nxt)
    for name, value in (effects.get("flags") or {}).items():
        state.flags[name] = value
    if "location" in effects:
        state.location = str(effects["location"])
    for fact in effects.get("known") or []:
        if fact not in state.known:
            state.known.append(fact)
    pid = effects.get("resolve_promise")
    if pid:
        found = _promise(state, pid)
        if found:
            found["resolved"] = True
    delay = effects.get("delay_promise")
    if delay:
        found = _promise(state, delay["id"])
        if found and not found.get("resolved"):
            found["due_turn"] = int(found.get("due_turn") or 0) + int(delay.get("by") or 0)
    created = effects.get("create_promise")
    if created and not _promise(state, created["id"]):
        item = copy.deepcopy(created)
        item.setdefault("resolved", False)
        item.setdefault("triggered", False)
        if action_id and not item.get("source_action_id"):
            item["source_action_id"] = action_id
        state.promises.append(item)
    scene = effects.get("scene")
    if scene:
        state.scene = copy.deepcopy(scene)
    _append_log(
        state,
        source=source,
        text=str(effects.get("log") or ""),
        action_id=action_id,
        label=label,
        acted_on_turn=acted_on_turn,
    )


def _apply_block(
    state: GameState,
    spec: dict[str, Any],
    *,
    source: str,
    action_id: str | None = None,
    acted_on_turn: int | None = None,
) -> None:
    label = str(spec.get("label") or "")
    _apply_effects(
        state,
        spec.get("effects"),
        source=source,
        action_id=action_id,
        label=label,
        acted_on_turn=acted_on_turn,
    )
    for extra in spec.get("effects_if") or []:
        if matches(extra.get("when"), state):
            _apply_effects(
                state,
                extra,
                source=source,
                action_id=action_id,
                label=label,
                acted_on_turn=acted_on_turn,
            )


def _run_npcs(state: GameState) -> None:
    for step in SCENARIO["npc_steps"]:
        sid = str(step["id"])
        if step.get("once") and sid in state.fired_npc:
            continue
        if not matches(step.get("when"), state):
            continue
        _apply_effects(state, step.get("effects"), source="npc")
        if step.get("once"):
            state.fired_npc.append(sid)


def _run_promises(state: GameState) -> None:
    for item in state.promises:
        if item.get("resolved") or item.get("triggered"):
            continue
        if state.turn < int(item.get("due_turn") or 0):
            continue
        item["triggered"] = True
        _apply_effects(state, item.get("overdue"), source="promise")
        _append_log(state, source="promise", text=str(item.get("overdue_log") or ""))


def _ending_causes(state: GameState) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[Any, Any]] = set()
    for entry in state.log:
        if entry.get("source") != "player" or not entry.get("action_id"):
            continue
        key = (entry.get("turn"), entry.get("action_id"))
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "turn": entry.get("turn"),
                "action_id": entry.get("action_id"),
                "label": entry.get("label") or "",
            }
        )
    return out


def _evaluate_ending(state: GameState) -> dict[str, Any] | None:
    for spec in SCENARIO["endings"]:
        if not spec.get("hard"):
            continue
        if matches(spec.get("when"), state):
            return {
                "id": spec["id"],
                "title": spec["title"],
                "body": spec["body"],
                "causes": _ending_causes(state),
            }
    if state.turn <= TURNS:
        return None
    for spec in SCENARIO["endings"]:
        if spec.get("hard"):
            continue
        if matches(spec.get("when"), state):
            return {
                "id": spec["id"],
                "title": spec["title"],
                "body": spec["body"],
                "causes": _ending_causes(state),
            }
    return None


def apply_action(state: GameState, action_id: str) -> tuple[GameState, str | None]:
    nxt = copy.deepcopy(state)
    if nxt.ending:
        return state, "already_ended"
    legal = _legal_defs(nxt)
    spec = next((a for a in legal if a["id"] == action_id), None)
    if spec is None:
        return state, "illegal_action"
    acted_on = nxt.turn
    _apply_block(nxt, spec, source="player", action_id=action_id, acted_on_turn=acted_on)
    nxt.turn += 1
    nxt.revision += 1
    _run_npcs(nxt)
    _run_promises(nxt)
    nxt.ending = _evaluate_ending(nxt)
    nxt.last_actions = [
        {"id": a["id"], "label": a["label"], "cost_text": a["cost_text"]} for a in _legal_defs(nxt)
    ]
    bits = [e.get("text") for e in nxt.log if e.get("turn") == acted_on]
    nxt.last_consequence = " ".join(t for t in bits if t)
    return nxt, None


def _visible_history(state: GameState) -> list[dict[str, Any]]:
    specs = {a["id"]: a for a in SCENARIO["actions"]}
    out: list[dict[str, Any]] = []
    seen_player: set[tuple[Any, Any]] = set()
    for entry in state.log:
        source = entry.get("source")
        if source not in ("player", "npc", "promise"):
            continue
        text = str(entry.get("text") or "").strip()
        if not text:
            continue
        if source == "player":
            key = (entry.get("turn"), entry.get("action_id"))
            if key in seen_player:
                for item in reversed(out):
                    if (
                        item.get("source") == "player"
                        and item.get("turn") == key[0]
                        and item.get("action_id") == key[1]
                    ):
                        item["text"] = f"{item['text']} {text}".strip()
                        break
                continue
            seen_player.add(key)
            spec = specs.get(str(entry.get("action_id") or "")) or {}
            out.append(
                {
                    "turn": entry.get("turn"),
                    "source": "player",
                    "text": text,
                    "action_id": entry.get("action_id"),
                    "label": entry.get("label") or spec.get("label") or "",
                    "cost_text": spec.get("cost_text") or "",
                }
            )
            continue
        out.append(
            {
                "turn": entry.get("turn"),
                "source": source,
                "text": text,
                "action_id": entry.get("action_id"),
                "label": entry.get("label") or "",
                "cost_text": "",
            }
        )
    return out


def player_view(state: GameState) -> dict[str, Any]:
    labels = SCENARIO.get("location_labels") or {}
    legal = [
        {"id": a["id"], "label": a["label"], "cost_text": a["cost_text"]}
        for a in (state.last_actions or _legal_defs(state))
    ]
    if not state.last_actions and not state.ending:
        legal = [
            {"id": a["id"], "label": a["label"], "cost_text": a["cost_text"]}
            for a in _legal_defs(state)
        ]
    promises = []
    for item in state.promises:
        if item.get("resolved"):
            continue
        promises.append(
            {
                "id": item["id"],
                "label": item.get("label") or "",
                "due_turn": item.get("due_turn"),
                "source_action_id": item.get("source_action_id"),
            }
        )
    history = _visible_history(state)
    return {
        "run_id": state.run_id,
        "revision": state.revision,
        "turn": min(state.turn, TURNS) if not state.ending else TURNS,
        "turns_max": TURNS,
        "location": state.location,
        "location_label": labels.get(state.location, state.location),
        "player": SCENARIO["player"],
        "objective": SCENARIO["objective"],
        "meters": dict(state.meters),
        "resources": dict(state.resources),
        "promises": promises,
        "known": list(state.known),
        "scene": dict(state.scene),
        "last_consequence": state.last_consequence,
        "legal_actions": [] if state.ending else legal,
        "ending": copy.deepcopy(state.ending),
        "history": history,
        "visibility": "player",
        "performance": None,
    }


def state_to_dict(state: GameState) -> dict[str, Any]:
    return {
        "run_id": state.run_id,
        "seed": state.seed,
        "revision": state.revision,
        "turn": state.turn,
        "meters": copy.deepcopy(state.meters),
        "resources": copy.deepcopy(state.resources),
        "location": state.location,
        "flags": copy.deepcopy(state.flags),
        "known": list(state.known),
        "promises": copy.deepcopy(state.promises),
        "fired_npc": list(state.fired_npc),
        "log": copy.deepcopy(state.log),
        "scene": copy.deepcopy(state.scene),
        "last_consequence": state.last_consequence,
        "ending": copy.deepcopy(state.ending),
        "last_actions": copy.deepcopy(state.last_actions),
    }


def state_from_dict(data: dict[str, Any]) -> GameState:
    payload = copy.deepcopy(data)
    return GameState(
        run_id=str(payload["run_id"]),
        seed=int(payload["seed"]),
        revision=int(payload["revision"]),
        turn=int(payload["turn"]),
        meters=dict(payload["meters"]),
        resources=dict(payload["resources"]),
        location=str(payload["location"]),
        flags=dict(payload["flags"]),
        known=list(payload.get("known") or []),
        promises=list(payload.get("promises") or []),
        fired_npc=list(payload.get("fired_npc") or []),
        log=list(payload.get("log") or []),
        scene=dict(payload.get("scene") or {"speaker": "", "body": ""}),
        last_consequence=str(payload.get("last_consequence") or ""),
        ending=payload.get("ending"),
        last_actions=list(payload.get("last_actions") or []),
    )
