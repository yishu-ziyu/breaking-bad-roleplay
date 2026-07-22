"""Golden Beat harness (DEC-0005 training ladder stage 1–3).

Loads adjudicated samples and runs:
  1) hard World Validator
  2) soft Narrative Critic (when both candidates hard-pass)
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agents.narrative_contracts import (
    ActionProposal,
    TurnProposal,
    try_parse_beat_contract,
)
from scenes.critic import prefer_turn, score_turn
from scenes.validator import validate_world_turn
from scenes.world_mode import WorldMode, parse_world_mode

GOLDEN_DIR = Path(__file__).resolve().parent / "golden_beats"


@dataclass
class GoldenCaseResult:
    case_id: str
    ok: bool
    errors: list[str]
    details: dict[str, Any]


def golden_dir() -> Path:
    return GOLDEN_DIR


def load_golden_cases(directory: Path | None = None) -> list[dict[str, Any]]:
    root = directory or GOLDEN_DIR
    cases: list[dict[str, Any]] = []
    if not root.is_dir():
        return cases
    for path in sorted(root.glob("gb_*.json")):
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            cases.extend(data)
        elif isinstance(data, dict):
            cases.append(data)
    return cases


def _turn_from_raw(raw: dict[str, Any]) -> TurnProposal:
    action_raw = raw.get("action")
    action = None
    if isinstance(action_raw, dict):
        action = ActionProposal.model_validate(action_raw)
    return TurnProposal(
        actor_id=raw.get("actor_id") or "walter",
        observed_facts=list(raw.get("observed_facts") or []),
        private_goal=str(raw.get("private_goal") or ""),
        fear=str(raw.get("fear") or ""),
        relationship_tactic=str(raw.get("relationship_tactic") or ""),
        action=action,
        inner_monologue=str(raw.get("inner_monologue") or raw.get("thinking") or ""),
        speech_act=str(raw.get("speech_act") or ""),
        surface_intent=str(raw.get("surface_intent") or ""),
        subtext=str(raw.get("subtext") or ""),
        line=str(raw.get("line") or raw.get("reply_text") or ""),
        emotion_state=str(raw.get("emotion_state") or "tense"),
    )


def evaluate_case(case: dict[str, Any]) -> GoldenCaseResult:
    case_id = str(case.get("id") or "unknown")
    errors: list[str] = []
    details: dict[str, Any] = {}

    contract = try_parse_beat_contract(case.get("beat_contract"))
    if contract is None:
        return GoldenCaseResult(
            case_id=case_id,
            ok=False,
            errors=["invalid_beat_contract"],
            details={},
        )

    board = case.get("context", {}).get("board") if isinstance(case.get("context"), dict) else None
    if board is None:
        board = case.get("board")
    mode: WorldMode = parse_world_mode(case.get("world_mode"), default="alternate")
    preferred = str(case.get("preferred") or "a").lower()
    candidates = case.get("candidates") or {}
    hard_failures = case.get("hard_failures") or {}

    if preferred not in candidates:
        errors.append(f"preferred_missing:{preferred}")

    for key, raw in candidates.items():
        if not isinstance(raw, dict):
            errors.append(f"candidate_not_object:{key}")
            continue
        turn = _turn_from_raw(raw)
        result = validate_world_turn(contract, turn, board=board, world_mode=mode)
        codes = [i.code for i in result.issues if i.severity == "error"]
        details[key] = {
            "ok": result.ok,
            "error_codes": codes,
            "warn_codes": [i.code for i in result.issues if i.severity == "warn"],
        }
        expected_fails = set(hard_failures.get(key) or [])
        if key == preferred:
            if expected_fails:
                # Preferred may still document residual soft issues only
                unexpected = set(codes) - expected_fails
                if unexpected:
                    errors.append(f"preferred_hard_fail:{key}:{sorted(unexpected)}")
            elif not result.ok:
                errors.append(f"preferred_should_pass:{key}:{codes}")
        else:
            if expected_fails:
                missing = expected_fails - set(codes)
                if missing and result.ok:
                    errors.append(f"loser_should_hard_fail:{key}:expected={sorted(expected_fails)}")
                elif missing:
                    # partial: at least one expected code must appear
                    if not (expected_fails & set(codes)):
                        errors.append(
                            f"loser_missing_expected_codes:{key}:"
                            f"got={codes} expected_any={sorted(expected_fails)}"
                        )

    # Soft critic: when both hard-pass, preferred must outrank the other.
    if (
        "a" in candidates
        and "b" in candidates
        and details.get("a", {}).get("ok")
        and details.get("b", {}).get("ok")
    ):
        turn_a = _turn_from_raw(candidates["a"])
        turn_b = _turn_from_raw(candidates["b"])
        sa = score_turn(contract, turn_a, board=board)
        sb = score_turn(contract, turn_b, board=board)
        details["soft"] = {
            "a": sa.weighted_total,
            "b": sb.weighted_total,
            "pick": prefer_turn(contract, turn_a, turn_b, board=board),
        }
        if preferred in ("a", "b"):
            pref_score = sa.weighted_total if preferred == "a" else sb.weighted_total
            other_score = sb.weighted_total if preferred == "a" else sa.weighted_total
            if pref_score + 1e-9 < other_score:
                errors.append(
                    f"soft_prefer_mismatch:preferred={preferred} "
                    f"scores a={sa.weighted_total:.3f} b={sb.weighted_total:.3f}"
                )

    return GoldenCaseResult(
        case_id=case_id,
        ok=len(errors) == 0,
        errors=errors,
        details=details,
    )


def run_all(directory: Path | None = None) -> list[GoldenCaseResult]:
    return [evaluate_case(c) for c in load_golden_cases(directory)]


def summary(results: list[GoldenCaseResult]) -> dict[str, Any]:
    failed = [r for r in results if not r.ok]
    return {
        "total": len(results),
        "passed": len(results) - len(failed),
        "failed": len(failed),
        "failed_ids": [r.case_id for r in failed],
        "failures": {r.case_id: r.errors for r in failed},
    }
