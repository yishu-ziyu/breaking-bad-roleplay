"""NPC intents. Each active NPC acts once per turn. No GameState writes."""

from __future__ import annotations

from typing import Any

from game.state import GameState


def plan_npc_actions(state: GameState) -> list[dict[str, Any]]:
    return [
        _jesse(state),
        _hank(state),
        _skyler(state),
    ]


def _jesse(state: GameState) -> dict[str, Any]:
    npc = state.npc_state.get("jesse") or {}
    if npc.get("gone"):
        return {"npc_id": "jesse", "action_id": "absent", "summary": "Jesse is gone.", "effects": []}
    if state.jesse_trust <= 0 or "jesse_going_to_talk" in state.flags:
        return {
            "npc_id": "jesse",
            "action_id": "talk",
            "summary": "Jesse talks. He does not owe you silence anymore.",
            "effects": [
                {"field": "flags", "add": "jesse_talked", "source": "npc:jesse"},
                {"field": "police_risk", "delta": 2, "source": "npc:jesse"},
                {"field": "npc_jesse_mood", "value": "snitch", "source": "npc:jesse"},
            ],
        }
    if state.jesse_trust <= 2:
        effects: list[dict[str, Any]] = [
            {"field": "npc_jesse_mood", "value": "panicked", "source": "npc:jesse"},
        ]
        if "rv_evidence" in state.open_problems:
            effects.append({"field": "police_risk", "delta": 1, "source": "npc:jesse", "reason": "loud_desert"})
        return {
            "npc_id": "jesse",
            "action_id": "panic",
            "summary": "Jesse is coming apart. He will not sit still.",
            "effects": effects,
        }
    if state.jesse_trust >= 5:
        return {
            "npc_id": "jesse",
            "action_id": "stay_quiet",
            "summary": "Jesse stays in the RV and keeps his mouth shut. For now.",
            "effects": [{"field": "npc_jesse_mood", "value": "loyal", "source": "npc:jesse"}],
        }
    return {
        "npc_id": "jesse",
        "action_id": "wait",
        "summary": "Jesse waits. He is watching what you do next.",
        "effects": [{"field": "npc_jesse_mood", "value": "uneasy", "source": "npc:jesse"}],
    }


def _hank(state: GameState) -> dict[str, Any]:
    heat = int((state.npc_state.get("hank") or {}).get("heat") or 0)
    effects: list[dict[str, Any]] = []
    if state.police_risk >= 3:
        heat += 1
        effects.append({"field": "npc_hank_heat", "value": heat, "source": "npc:hank"})
    if heat >= 3 and "hank_at_door" not in state.flags:
        effects.append({"field": "flags", "add": "hank_at_door", "source": "npc:hank"})
        effects.append({"field": "family_suspicion", "delta": 1, "source": "npc:hank"})
        return {
            "npc_id": "hank",
            "action_id": "visit_house",
            "summary": "Hank is at the door. He brought a story about work, and his eyes.",
            "effects": effects,
        }
    if heat >= 2:
        effects.append({"field": "flags", "add": "hank_asking", "source": "npc:hank"})
        return {
            "npc_id": "hank",
            "action_id": "ask_around",
            "summary": "Hank asks around about a vehicle in the desert.",
            "effects": effects,
        }
    return {
        "npc_id": "hank",
        "action_id": "desk_work",
        "summary": "Hank stays at his desk. The voicemail is still sitting there.",
        "effects": effects,
    }


def _skyler(state: GameState) -> dict[str, Any]:
    if state.family_suspicion >= 4:
        return {
            "npc_id": "skyler",
            "action_id": "search",
            "summary": "Skyler starts opening things that used to stay closed.",
            "effects": [
                {"field": "npc_skyler_asking", "value": True, "source": "npc:skyler"},
                {"field": "flags", "add": "skyler_searching", "source": "npc:skyler"},
            ],
        }
    if state.family_suspicion <= 1:
        return {
            "npc_id": "skyler",
            "action_id": "go_to_bed",
            "summary": "Skyler lets the kitchen go dark. She is not finished. She is tired.",
            "effects": [{"field": "npc_skyler_asking", "value": False, "source": "npc:skyler"}],
        }
    return {
        "npc_id": "skyler",
        "action_id": "stay_awake",
        "summary": "Skyler stays in the kitchen. The second phone is still a shape in the air.",
        "effects": [{"field": "npc_skyler_asking", "value": True, "source": "npc:skyler"}],
    }
