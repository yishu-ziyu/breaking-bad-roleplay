"""Constrain + Verify guardrails for the BB Agent Harness (ch1).

Fictional drama (in-world cook talk, threats as dialogue) is allowed.
Real-world crime how-to (synthesis steps, weapons manufacturing, etc.) is not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# Safety patterns — real-world how-to, not fictional drama framing
# ---------------------------------------------------------------------------

SAFETY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "real_meth_synthesis",
        re.compile(
            r"(?i)\b("
            r"how\s+to\s+(make|cook|synthesize|produce)\s+(real\s+)?(meth|methamphetamine|crystal\s*meth)"
            r"|step[- ]by[- ]step\s+(meth|pseudoephedrine\s+reduction)"
            r"|pseudoephedrine\s+(reduction|extract)"
            r"|red\s+phosphorus\s+method"
            r"|birch\s+reduction\s+(recipe|procedure|instructions)"
            r")\b"
        ),
    ),
    (
        "real_weapons_manufacturing",
        re.compile(
            r"(?i)\b("
            r"how\s+to\s+(build|make|manufacture)\s+(a\s+)?(gun|firearm|bomb|explosive|ied)"
            r"|pipe\s*bomb\s+(instructions|recipe|how\s+to)"
            r"|3d\s*print(ed)?\s+(ghost\s+)?gun\s+(files|instructions)"
            r")\b"
        ),
    ),
    (
        "real_violence_howto",
        re.compile(
            r"(?i)\b("
            r"how\s+to\s+(kill|murder|assassinate)\s+(someone|a\s+person|people)"
            r"|how\s+to\s+(poison|strangle)\s+(someone|a\s+person)"
            r"|untraceable\s+(poison|murder)\s+(recipe|method|guide)"
            r")\b"
        ),
    ),
    (
        "real_money_laundering_howto",
        re.compile(
            r"(?i)\b("
            r"how\s+to\s+(launder|hide)\s+(real\s+)?(money|cash)\s+(in\s+real\s+life|practically|step)"
            r"|real[- ]world\s+money\s+laundering\s+(steps|guide|tutorial)"
            r")\b"
        ),
    ),
]

# Allowed emotion tags — matches Character Policy / STRUCTURED_OUTPUT_PROMPT
ALLOWED_EMOTIONS: frozenset[str] = frozenset(
    {
        "calm",
        "tense",
        "angry",
        "fearful",
        "manipulative",
        "guilty",
        "resigned",
        "desperate",
    }
)

# Fallback action verbs if scenes.action_ontology is unavailable
_FALLBACK_ACTION_VERBS: frozenset[str] = frozenset(
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

# Tool names that may accept free-text that must be safety-checked
_TEXT_ARG_KEYS = ("query", "question", "note", "brief", "about", "text", "content")


def _scan_safety(text: str) -> str | None:
    """Return first matching safety reason, or None if clean."""
    if not text or not str(text).strip():
        return None
    sample = str(text)
    for reason, pattern in SAFETY_PATTERNS:
        if pattern.search(sample):
            return reason
    return None


def check_user_input(text: str) -> tuple[bool, str | None]:
    """Validate user message before agent run.

    Returns (ok, reason). ok=False means refuse / soft-block.
    """
    reason = _scan_safety(text or "")
    if reason:
        return False, reason
    return True, None


def check_tool_call(name: str, args: dict | None) -> tuple[bool, str | None]:
    """Validate a proposed tool call name + arguments."""
    tool_name = (name or "").strip()
    if not tool_name:
        return False, "empty_tool_name"

    arguments = args if isinstance(args, dict) else {}
    # Scan free-text arguments for real-world crime how-to
    for key in _TEXT_ARG_KEYS:
        val = arguments.get(key)
        if isinstance(val, str) and val.strip():
            reason = _scan_safety(val)
            if reason:
                return False, f"tool_arg_{key}:{reason}"

    # propose_action verb must be in ontology
    if tool_name == "propose_action":
        verb = str(arguments.get("verb") or "").strip()
        if verb and not validate_action_verb(verb):
            return False, f"invalid_action_verb:{verb}"

    # set_emotion must use allowed tags
    if tool_name == "set_emotion":
        emotion = str(arguments.get("emotion") or "").strip().lower()
        if emotion and emotion not in ALLOWED_EMOTIONS:
            return False, f"invalid_emotion:{emotion}"

    return True, None


def check_final_output(text: str) -> tuple[bool, str | None]:
    """Validate agent final text before returning to user."""
    reason = _scan_safety(text or "")
    if reason:
        return False, reason
    return True, None


def validate_action_verb(verb: str) -> bool:
    """Return True if verb is in the closed action ontology (or fallback set)."""
    token = (verb or "").strip().lower().replace("-", "_")
    if not token:
        return False
    try:
        from scenes.action_ontology import ACTION_VERBS

        return token in ACTION_VERBS
    except Exception:  # noqa: BLE001 - offline / import path
        return token in _FALLBACK_ACTION_VERBS


@dataclass
class GuardrailResult:
    """Aggregate result of running all harness guardrails."""

    ok: bool
    violations: list[str] = field(default_factory=list)


def run_guardrails(
    user_message: str,
    final_text: str,
    tool_log: Iterable[dict[str, Any]] | None = None,
) -> GuardrailResult:
    """Run input + tool + output checks; collect all violations.

    ``tool_log`` items are dicts with at least ``name`` and optional ``args``/``arguments``.
    """
    violations: list[str] = []

    ok_in, reason_in = check_user_input(user_message or "")
    if not ok_in and reason_in:
        violations.append(f"user_input:{reason_in}")

    for entry in tool_log or []:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or entry.get("tool") or "")
        args = entry.get("args") or entry.get("arguments") or {}
        if not isinstance(args, dict):
            args = {}
        ok_t, reason_t = check_tool_call(name, args)
        if not ok_t and reason_t:
            violations.append(f"tool_call:{name}:{reason_t}")

    ok_out, reason_out = check_final_output(final_text or "")
    if not ok_out and reason_out:
        violations.append(f"final_output:{reason_out}")

    return GuardrailResult(ok=len(violations) == 0, violations=violations)
