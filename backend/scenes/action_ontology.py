"""Closed action vocabulary for agent_act / Turn Proposal (MVP Stage Kit).

Unknown verbs map to a safe idle rather than crashing the pipeline.
"""

from __future__ import annotations

from typing import Any

# MVP verbs — keep tiny; Stage Compiler maps these to anchors/animations later.
ACTION_VERBS: frozenset[str] = frozenset(
    {
        "enter",
        "exit",
        "walk_to",
        "sit",
        "stand",
        "turn_to",
        "look_at",
        "gesture",
        "hand_over",
        "open",
        "close",
        "idle",
        "idle_tense",
    }
)

# Free-text Director drafts → nearest verb.
_SYNONYMS: dict[str, str] = {
    "walk": "walk_to",
    "walks": "walk_to",
    "walking": "walk_to",
    "approach": "walk_to",
    "approaches": "walk_to",
    "move": "walk_to",
    "moves": "walk_to",
    "go": "walk_to",
    "goes": "walk_to",
    "sit_down": "sit",
    "sits": "sit",
    "sitting": "sit",
    "stand_up": "stand",
    "stands": "stand",
    "standing": "stand",
    "turn": "turn_to",
    "turns": "turn_to",
    "look": "look_at",
    "looks": "look_at",
    "stare": "look_at",
    "point": "gesture",
    "points": "gesture",
    "gesture": "gesture",
    "hand": "hand_over",
    "pass": "hand_over",
    "give": "hand_over",
    "enter": "enter",
    "enters": "enter",
    "exit": "exit",
    "exits": "exit",
    "leave": "exit",
    "leaves": "exit",
    "open": "open",
    "opens": "open",
    "close": "close",
    "closes": "close",
    "shut": "close",
}


def normalize_verb_token(raw: str | None) -> str:
    if not raw:
        return ""
    s = str(raw).strip().lower()
    # "walks toward Saul's desk" → first token
    for sep in (" ", "→", "->", "(", "（"):
        if sep in s:
            s = s.split(sep, 1)[0]
    s = s.replace("-", "_")
    return s.strip(".,;:\"'")


def map_action_verb(raw: str | None) -> tuple[str, bool]:
    """Return (canonical_verb, was_mapped_from_unknown).

    Unknown free text maps to ``idle_tense`` so the beat still commits.
    """
    token = normalize_verb_token(raw)
    if not token:
        return "idle_tense", True
    if token in ACTION_VERBS:
        return token, False
    if token in _SYNONYMS:
        return _SYNONYMS[token], True
    # substring: "walk_to_desk" style
    for syn, verb in _SYNONYMS.items():
        if syn in token or token in syn:
            return verb, True
    for verb in ACTION_VERBS:
        if verb in token:
            return verb, True
    return "idle_tense", True


def canonicalize_action_dict(action: dict[str, Any] | None) -> dict[str, Any] | None:
    """Normalize a TurnProposal.action-like dict in place-friendly copy."""
    if not action:
        return None
    out = dict(action)
    verb, mapped = map_action_verb(out.get("verb") or out.get("action"))
    out["verb"] = verb
    if mapped:
        out["mapped_from"] = out.get("verb_raw") or action.get("verb") or action.get("action")
    return out
