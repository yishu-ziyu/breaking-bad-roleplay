"""Loop 13 Commit 2 — fixture schema validation for ``value_flip_review``.

Verifies that any future golden case declaring ``value_flip_review`` is
checked against the closed schema regardless of polarity verdict.
"""

from __future__ import annotations

from eval.golden_harness import (
    evaluate_case,
    evaluate_value_flip,
    load_golden_cases,
    validate_value_flip_review_schema,
)


def _stub_case(
    *,
    flip_before=None,
    flip_after=None,
    review=None,
    case_id="schema_case",
):
    return {
        "id": case_id,
        "world_mode": "alternate",
        "context": {
            "board": {
                "present_cast": ["walter"],
                "shared_facts": [],
                "irreversible_costs": [],
            }
        },
        "beat_contract": {
            "beat_id": "b1",
            "dramatic_role": "progressive",
            "location_id": "loc",
            "present_characters": ["walter"],
            "value_before": "X",
            "value_after": "Y",
            "dramatic_question": "?",
            "pressure_source": "p",
            "required_outcome": [],
            "forbidden_outcomes": [],
        },
        "candidates": {
            "a": {
                "actor_id": "walter",
                "line": "ok",
                "emotion_state": "tense",
            }
        },
        "preferred": "a",
        "hard_failures": {},
        "value_polarity_before": flip_before,
        "value_polarity_after": flip_after,
        "value_flip_review": review,
    }


# --- validate_value_flip_review_schema (pure schema) ------------------------


def test_schema_no_review_is_clean():
    assert validate_value_flip_review_schema({"id": "x"}) == []


def test_schema_review_must_be_object():
    errors = validate_value_flip_review_schema({"value_flip_review": "not a dict"})
    assert errors == ["value_flip_review_not_object"]


def test_schema_escape_true_requires_nonempty_note():
    errors = validate_value_flip_review_schema(
        {"value_flip_review": {"escape_hatch": True, "reviewer_note": ""}}
    )
    assert "value_flip_note_missing" in errors


def test_schema_escape_false_does_not_require_note():
    errors = validate_value_flip_review_schema(
        {"value_flip_review": {"escape_hatch": False}}
    )
    assert errors == []


def test_schema_escape_true_with_note_is_clean():
    errors = validate_value_flip_review_schema(
        {
            "value_flip_review": {
                "escape_hatch": True,
                "reviewer_note": "reviewed by PM",
            }
        }
    )
    assert errors == []


# --- evaluate_value_flip + evaluate_case integration -------------------------


def test_escape_with_empty_note_fails_even_when_polarity_flips():
    """The brief: 'escape_hatch: true without non-empty reviewer_note fails'.

    This must hold even when polarity tokens differ, because the schema
    invariant is independent of the polarity verdict.
    """
    case = _stub_case(
        flip_before="stability",
        flip_after="threat",
        review={"escape_hatch": True, "reviewer_note": ""},
    )
    result = evaluate_value_flip(case)
    assert result["status"] == "fail"
    assert result["code"] == "value_flip_note_missing"


def test_review_not_object_fails_regardless_of_polarity():
    case = _stub_case(
        flip_before="stability",
        flip_after="threat",
        review="oops-string",
    )
    result = evaluate_value_flip(case)
    assert result["status"] == "fail"
    assert result["code"] == "value_flip_review_not_object"


def test_evaluate_case_propagates_schema_failure():
    case = _stub_case(
        case_id="bad_schema",
        flip_before="stability",
        flip_after="threat",
        review={"escape_hatch": True},  # missing reviewer_note
    )
    result = evaluate_case(case)
    assert not result.ok
    codes = [e.split(":", 1)[0] for e in result.errors]
    assert "value_flip_note_missing" in codes


# --- corpus-level invariant --------------------------------------------------


def test_corpus_has_no_equal_value_before_value_after_cases():
    """Brief: zero existing 51-case fixtures have equal before/after values.

    This is a regression guard: if a future loop silently introduces one, the
    schema-migration step is no longer a no-op.
    """
    cases = load_golden_cases()
    assert len(cases) >= 51
    for c in cases:
        bc = c.get("beat_contract") or {}
        vb = (bc.get("value_before") or "").strip()
        va = (bc.get("value_after") or "").strip()
        if vb and va:
            assert vb != va, f"{c.get('id')} has equal value_before/value_after"
        # And no fixture should already declare value_flip_review.
        assert "value_flip_review" not in c, (
            f"{c.get('id')} already declares value_flip_review; "
            "Commit 2 expected no pre-existing escape metadata."
        )