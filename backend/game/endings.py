"""Win / loss / cost endings. Pure evaluation — no writes."""

from __future__ import annotations

from typing import Any

from game.state import MAX_TURNS, METER_MAX, GameState

ENDINGS: dict[str, dict[str, Any]] = {
    "cuffed": {
        "id": "cuffed",
        "kind": "loss",
        "title": "Cuffed",
        "title_zh": "戴上手铐",
        "text": "Hank does not need the whole story. He has enough of this one.",
        "text_zh": "汉克不需要完整故事。这一夜已经够他用了。",
    },
    "family_gone": {
        "id": "family_gone",
        "kind": "loss",
        "title": "The house empties",
        "title_zh": "屋子空了",
        "text": "Skyler takes the kids before dawn. The kitchen light stays on for nobody.",
        "text_zh": "天亮前斯凯勒带走了孩子。厨房的灯还亮着，没有人在家。",
    },
    "snitch": {
        "id": "snitch",
        "kind": "loss",
        "title": "Jesse talks",
        "title_zh": "杰西开口了",
        "text": "Jesse finds someone who will listen. It is not you.",
        "text_zh": "杰西找到了愿意听的人。那个人不是你。",
    },
    "contained": {
        "id": "contained",
        "kind": "win",
        "title": "The night holds",
        "title_zh": "这一夜撑住了",
        "text": "Dawn comes. The RV is no longer a loaded gun. Jesse is still yours. The house is still a house.",
        "text_zh": "天亮了。房车不再是一把上膛的枪。杰西还在你这边。家还是家。",
    },
    "ticking": {
        "id": "ticking",
        "kind": "cost",
        "title": "The RV is still out there",
        "title_zh": "房车还在外面",
        "text": "You live. The desert still has yesterday in it. Dawn does not erase that.",
        "text_zh": "你活过了这一夜。沙漠里还留着昨天。天亮不会把它擦掉。",
    },
    "pyrrhic": {
        "id": "pyrrhic",
        "kind": "cost",
        "title": "You live. The bill does too.",
        "title_zh": "你活着。账单也活着。",
        "text": "The night ends. Something you bought cheap will collect in daylight.",
        "text_zh": "夜结束了。你便宜买下的东西，会在白天来收账。",
    },
}


def evaluate_ending(state: GameState) -> dict[str, Any] | None:
    if state.police_risk >= METER_MAX:
        return dict(ENDINGS["cuffed"])
    if state.family_suspicion >= METER_MAX:
        return dict(ENDINGS["family_gone"])
    if "jesse_talked" in state.flags:
        return dict(ENDINGS["snitch"])
    if state.turn < MAX_TURNS:
        return None
    rv_clean = (
        "rv_evidence" not in state.open_problems
        and state.objective_state.get("contain_rv") == "resolved"
    )
    quiet_enough = (
        state.police_risk < 5
        and state.family_suspicion < 5
        and state.jesse_trust >= 3
        and not state.debts
    )
    if rv_clean and quiet_enough:
        return dict(ENDINGS["contained"])
    if not rv_clean:
        return dict(ENDINGS["ticking"])
    return dict(ENDINGS["pyrrhic"])
