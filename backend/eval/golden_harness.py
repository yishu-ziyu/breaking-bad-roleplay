"""Golden Beat harness (DEC-0005 training ladder stage 1–3).

Loads adjudicated samples and runs:
  1) hard World Validator
  2) soft Narrative Critic (when both candidates hard-pass)
  3) value-flip polarity gate (Loop 13; evaluation-only, additive)
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Make `agents` and `scenes` resolvable when this module is invoked as
# `python -m backend.eval.golden_harness` from the repo root (Commit 3).
# We only add the backend/ directory itself; this is a no-op for the legacy
# `cd backend && python -m eval.golden_harness` invocation.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from agents.narrative_contracts import (  # noqa: E402
    ActionProposal,
    TurnProposal,
    try_parse_beat_contract,
)
from scenes.critic import prefer_turn, score_turn  # noqa: E402
from scenes.validator import validate_world_turn  # noqa: E402
from scenes.world_mode import WorldMode, parse_world_mode  # noqa: E402

GOLDEN_DIR = Path(__file__).resolve().parent / "golden_beats"

# Closed polarity vocabulary for the value-flip gate (Loop 13).
# Evaluation-only — never written into the McKee spine / BeatContract.
VALUE_FLIP_POLARITY_VOCAB: frozenset[str] = frozenset(
    {
        "stability",
        "threat",
        "trust",
        "control",
        "hope",
        "denial",
        "fear",
        "exposure",
        "leverage",
        "dominance",
        "doubt",
        "guilt",
        "alliance",
        "isolation",
    }
)


@dataclass
class GoldenCaseResult:
    case_id: str
    ok: bool
    errors: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


def golden_dir() -> Path:
    return GOLDEN_DIR


# ---------------------------------------------------------------------------
# Value-flip polarity gate (Loop 13) — additive, evaluation-only
# ---------------------------------------------------------------------------


def validate_value_flip_review_schema(case: dict[str, Any]) -> list[str]:
    """Schema-level checks on the optional ``value_flip_review`` block.

    Runs regardless of polarity verdict so a future fixture that
    misspells the review object fails fast at the harness boundary.

    Returns a list of stable error codes. Empty list = compliant.
    Possible codes:

      - ``value_flip_review_not_object`` — review block is not a JSON object
      - ``value_flip_note_missing``      — ``escape_hatch`` true but ``reviewer_note``
                                           empty / non-string / missing
    """
    review = case.get("value_flip_review")
    if review is None:
        return []
    if not isinstance(review, dict):
        return ["value_flip_review_not_object"]
    flag = review.get("escape_hatch")
    note = review.get("reviewer_note")
    errors: list[str] = []
    if flag is True and not (isinstance(note, str) and note.strip()):
        errors.append("value_flip_note_missing")
    return errors


def _validate_escape(review: dict[str, Any]) -> dict[str, Any]:
    """Validate ``value_flip_review`` for a non-flip case.

    Stable failure codes (additive; do not collide with validator codes):
      - ``value_flip_note_missing``   — ``escape_hatch`` true but ``reviewer_note`` empty
      - ``value_flip_flag_missing``   — ``reviewer_note`` non-empty but ``escape_hatch`` not True
      - ``value_flip_missing_escape`` — neither flag nor note supplied
    """
    flag = review.get("escape_hatch")
    note = review.get("reviewer_note")
    has_note = isinstance(note, str) and note.strip() != ""

    if flag is True and has_note:
        return {
            "status": "escaped",
            "code": "value_flip_ok",
            "reason": "equal polarity, escape hatch approved",
            "reviewer_note": note,
        }
    if flag is True and not has_note:
        return {
            "status": "fail",
            "code": "value_flip_note_missing",
            "reason": "escape_hatch=true requires non-empty reviewer_note",
        }
    if has_note and flag is not True:
        return {
            "status": "fail",
            "code": "value_flip_flag_missing",
            "reason": "non-empty reviewer_note requires escape_hatch=true",
        }
    return {
        "status": "fail",
        "code": "value_flip_missing_escape",
        "reason": "polarity equal, no escape hatch provided",
    }


def evaluate_value_flip(case: dict[str, Any]) -> dict[str, Any]:
    """Decide whether a golden case's ``value_before`` → ``value_after`` flips.

    Four observable outcomes:

    * ``flip``      — fixture declared ``value_polarity_before`` and
      ``value_polarity_after`` (both in the closed vocabulary) and they differ.
    * ``escaped``   — polarity tokens are equal AND a valid
      ``value_flip_review`` (escape_hatch=true AND non-empty reviewer_note) is
      present. Counts as a pass.
    * ``fail``      — either (a) polarity tokens are equal without a valid
      escape hatch, OR (b) ``value_flip_review`` itself is malformed. Stable
      failure code attached.
    * ``ambiguous`` — insufficient metadata (one or both polarity tokens
      missing or out of vocabulary). Additive: does NOT fail the case;
      surfaces a diagnostic so future fixture authors are nudged toward
      declaring ``value_polarity_*``.

    This function does not mutate the McKee spine or the BeatContract schema;
    fixture-level fields are read off the case dict only.
    """
    schema_errors = validate_value_flip_review_schema(case)
    if schema_errors:
        return {
            "status": "fail",
            "code": schema_errors[0],
            "all_codes": schema_errors,
            "reason": "schema violation in value_flip_review",
        }

    flip_before = case.get("value_polarity_before")
    flip_after = case.get("value_polarity_after")
    review = case.get("value_flip_review") or {}
    if not isinstance(review, dict):
        review = {}

    has_before = isinstance(flip_before, str) and flip_before.strip() != ""
    has_after = isinstance(flip_after, str) and flip_after.strip() != ""

    if has_before and has_after:
        b = flip_before.strip().lower()
        a = flip_after.strip().lower()
        in_vocab = b in VALUE_FLIP_POLARITY_VOCAB and a in VALUE_FLIP_POLARITY_VOCAB
        if in_vocab:
            if b == a:
                return _validate_escape(review)
            return {
                "status": "flip",
                "code": "value_flip_ok",
                "before": b,
                "after": a,
                "reason": "polarity tokens differ within vocabulary",
            }
        return {
            "status": "ambiguous",
            "code": "value_flip_ambiguous",
            "reason": "polarity tokens outside closed vocabulary",
        }

    return {
        "status": "ambiguous",
        "code": "value_flip_ambiguous",
        "reason": "polarity tokens not declared on fixture",
    }


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

    # --- Loop 13 value-flip polarity gate (additive, evaluation-only) ----
    flip = evaluate_value_flip(case)
    details["value_flip"] = flip
    if flip["status"] == "fail":
        errors.append(f"{flip['code']}:{flip.get('reason','')}")

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
