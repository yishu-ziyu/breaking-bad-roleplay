"""Structured player actions — costs, requirements, effects. Not prompt text."""

from __future__ import annotations

from typing import Any
import copy

from game.state import GameState

ACTION_CATALOG: list[dict[str, Any]] = [
    {
        "id": "lie_to_skyler",
        "label": "Lie to Skyler (Elliott alibi)",
        "label_zh": "对斯凯勒撒谎（艾略特不在场证明）",
        "costs": {},
        "requirements": [{"type": "skyler_asking"}],
        "deterministic_effects": [{"field": "family_suspicion", "delta": -1}],
        "risk_profile": {"family_suspicion": "short_term_drop"},
        "creates_debt": "elliott_alibi",
        "summary": "Buy a quiet kitchen tonight. The story will have to hold if Hank asks later.",
        "summary_zh": "今晚厨房能安静一点。如果汉克以后问起，这个故事必须站得住。",
    },
    {
        "id": "clean_rv",
        "label": "Deal with the RV",
        "label_zh": "处理房车",
        "costs": {},
        "requirements": [{"type": "has_problem", "value": "rv_evidence"}],
        "deterministic_effects": [
            {"field": "open_problems", "remove": "rv_evidence"},
            {"field": "jesse_trust", "delta": 1},
            {"field": "police_risk", "delta": 1},
            {"field": "objective_state", "key": "contain_rv", "value": "resolved"},
        ],
        "risk_profile": {"police_risk": "desert_time"},
        "creates_debt": None,
        "summary": "Hours on the dirt road. Jesse notices you showed up. So might anyone else.",
        "summary_zh": "土路上要耗掉几个小时。杰西会看见你来了。别人也可能看见。",
    },
    {
        "id": "pay_jesse",
        "label": "Pay Jesse to stay quiet",
        "label_zh": "给杰西钱，让他闭嘴",
        "costs": {"cash": 100},
        "requirements": [
            {"type": "min_cash", "value": 100},
            {"type": "npc_present", "value": "jesse"},
        ],
        "deterministic_effects": [
            {"field": "cash", "delta": -100},
            {"field": "jesse_trust", "delta": 2},
        ],
        "risk_profile": {},
        "creates_debt": None,
        "summary": "Cash now. Loyalty tonight. He will remember who paid and who didn't.",
        "summary_zh": "现在给现金，今晚买忠诚。他会记住谁付了、谁没有。",
    },
    {
        "id": "chase_jesse",
        "label": "Go after Jesse",
        "label_zh": "去追杰西",
        "costs": {},
        "requirements": [{"type": "npc_present", "value": "jesse"}],
        "deterministic_effects": [{"field": "jesse_trust", "delta": 1}],
        "risk_profile": {"police_risk": "if_jesse_panicked"},
        "creates_debt": None,
        "summary": "Find him before he does something loud. Being seen is the cost.",
        "summary_zh": "在他把事情闹大之前找到他。被人看见就是代价。",
    },
    {
        "id": "call_saul",
        "label": "Call Saul",
        "label_zh": "打电话给索尔",
        "costs": {"cash": 200, "saul_favor": 1},
        "requirements": [{"type": "min_cash", "value": 200}],
        "deterministic_effects": [
            {"field": "cash", "delta": -200},
            {"field": "saul_favor", "delta": -1},
            {"field": "police_risk", "delta": -1},
        ],
        "risk_profile": {},
        "creates_debt": "saul_marker",
        "summary": "A lawyer who talks like a commercial. Cover tonight; a marker later.",
        "summary_zh": "一个说话像广告的律师。今晚有掩护，以后要还人情。",
    },
    {
        "id": "stay_home",
        "label": "Stay home. Play the family man.",
        "label_zh": "留在家里，演好丈夫",
        "costs": {},
        "requirements": [],
        "deterministic_effects": [
            {"field": "family_suspicion", "delta": -1},
            {"field": "jesse_trust", "delta": -1},
        ],
        "risk_profile": {"jesse_trust": "abandon_if_panicked"},
        "creates_debt": None,
        "summary": "The kitchen sees you. The desert does not.",
        "summary_zh": "厨房看得到你。沙漠看不到。",
    },
    {
        "id": "confront_hank",
        "label": "Face Hank",
        "label_zh": "面对汉克",
        "costs": {},
        "requirements": [{"type": "npc_present", "value": "hank"}],
        "deterministic_effects": [
            {"field": "police_risk", "delta": 2},
            {"field": "flags", "add": "hank_confronted"},
        ],
        "risk_profile": {"police_risk": "direct_heat"},
        "creates_debt": None,
        "summary": "Walk toward the badge. Control the conversation, or feed it.",
        "summary_zh": "朝那枚徽章走过去。要么控制住谈话，要么给它添火。",
    },
    {
        "id": "stash_cash",
        "label": "Stash the cash",
        "label_zh": "把现金藏起来",
        "costs": {},
        "requirements": [{"type": "min_cash", "value": 50}],
        "deterministic_effects": [{"field": "police_risk", "delta": -1}],
        "risk_profile": {"family_suspicion": "if_skyler_searching"},
        "creates_debt": None,
        "summary": "Less sitting out. More to explain if Skyler opens the wrong vent.",
        "summary_zh": "桌上少一点。如果斯凯勒打开不该开的通风口，就要多解释。",
    },
]


def get_action(action_id: str) -> dict[str, Any]:
    for action in ACTION_CATALOG:
        if action["id"] == action_id:
            return copy.deepcopy(action)
    raise ValueError(f"unknown action: {action_id}")


def meets_requirements(state: GameState, action: dict[str, Any]) -> bool:
    for req in action.get("requirements") or []:
        kind = req["type"]
        if kind == "min_cash" and state.cash < int(req["value"]):
            return False
        if kind == "has_problem" and req["value"] not in state.open_problems:
            return False
        if kind == "npc_present":
            npc = state.npc_state.get(req["value"]) or {}
            if npc.get("gone"):
                return False
        if kind == "skyler_asking":
            skyler = state.npc_state.get("skyler") or {}
            if not skyler.get("asking"):
                return False
    return True


def legal_actions(state: GameState) -> list[dict[str, Any]]:
    if state.ended:
        return []
    return [copy.deepcopy(a) for a in ACTION_CATALOG if meets_requirements(state, a)]


def player_effects(state: GameState, action: dict[str, Any], roll: float) -> list[dict[str, Any]]:
    """Deterministic effects plus seeded risk. Does not write state."""
    effects: list[dict[str, Any]] = []
    source = action["id"]
    for effect in action.get("deterministic_effects") or []:
        row = copy.deepcopy(effect)
        row["source"] = source
        effects.append(row)

    if source == "chase_jesse":
        jesse = state.npc_state.get("jesse") or {}
        if jesse.get("mood") == "panicked" and roll < 0.5:
            effects.append({"field": "police_risk", "delta": 1, "source": source, "reason": "seen_with_jesse"})
    if source == "stay_home":
        jesse = state.npc_state.get("jesse") or {}
        if jesse.get("mood") == "panicked":
            effects.append({"field": "create_debt", "debt_id": "jesse_abandoned", "source": source})
    if source == "stash_cash":
        hide = max(10, state.cash // 4)
        effects.append({"field": "cash", "delta": -hide, "source": source})
        if state.family_suspicion >= 3:
            effects.append(
                {"field": "family_suspicion", "delta": 1, "source": source, "reason": "skyler_notices_stash"}
            )
    if source == "confront_hank":
        heat = int((state.npc_state.get("hank") or {}).get("heat") or 0)
        heat_delta = -1 if state.police_risk < 4 else 1
        effects.append({"field": "npc_hank_heat", "delta": heat_delta, "source": source})
        # heat is informational for the risk profile; keep a no-op read so tests stay honest
        _ = heat
    return effects
