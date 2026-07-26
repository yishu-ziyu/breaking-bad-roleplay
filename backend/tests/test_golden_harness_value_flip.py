"""Loop 13 value-flip polarity gate — focused tests.

These tests exercise ``evaluate_value_flip`` directly with synthetic fixture
dicts to prove the four stable outcome codes plus the ambiguous branch.
They do not require on-disk golden cases to declare polarity tokens — the
harness treats missing tokens as ambiguous-but-not-failing (additive).
"""

from __future__ import annotations

from eval.golden_harness import (
    VALUE_FLIP_POLARITY_VOCAB,
    evaluate_case,
    evaluate_value_flip,
)


def _stub_case(
    *,
    flip_before=None,
    flip_after=None,
    review=None,
    case_id="synthetic",
):
    """Build a minimal valid fixture for evaluate_case.

    Includes the smallest possible ``beat_contract`` / ``candidates`` so the
    existing hard + soft path runs through without emitting errors that are
    unrelated to the value-flip gate.
    """
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
                "line": "hi",
                "emotion_state": "tense",
            }
        },
        "preferred": "a",
        "hard_failures": {},
        "value_polarity_before": flip_before,
        "value_polarity_after": flip_after,
        "value_flip_review": review,
    }


def test_polarity_vocab_is_closed_and_small():
    # Vocab must be small (≤ 16) and immutable from the caller side.
    assert isinstance(VALUE_FLIP_POLARITY_VOCAB, frozenset)
    assert 4 <= len(VALUE_FLIP_POLARITY_VOCAB) <= 16
    # Sample known tokens.
    assert "stability" in VALUE_FLIP_POLARITY_VOCAB
    assert "threat" in VALUE_FLIP_POLARITY_VOCAB
    assert "control" in VALUE_FLIP_POLARITY_VOCAB


def test_genuine_polarity_flip_passes():
    case = _stub_case(flip_before="stability", flip_after="threat")
    result = evaluate_value_flip(case)
    assert result["status"] == "flip"
    assert result["code"] == "value_flip_ok"
    assert result["before"] == "stability"
    assert result["after"] == "threat"


def test_non_flip_without_escape_fails_with_stable_code():
    case = _stub_case(flip_before="control", flip_after="control")
    result = evaluate_value_flip(case)
    assert result["status"] == "fail"
    assert result["code"] == "value_flip_missing_escape"


def test_escape_flag_without_note_fails():
    case = _stub_case(
        flip_before="control",
        flip_after="control",
        review={"escape_hatch": True, "reviewer_note": ""},
    )
    result = evaluate_value_flip(case)
    assert result["status"] == "fail"
    assert result["code"] == "value_flip_note_missing"


def test_escape_note_without_flag_fails():
    case = _stub_case(
        flip_before="control",
        flip_after="control",
        review={"escape_hatch": False, "reviewer_note": "approved by review"},
    )
    result = evaluate_value_flip(case)
    assert result["status"] == "fail"
    assert result["code"] == "value_flip_flag_missing"


def test_note_without_flag_at_all_fails_as_flag_missing():
    # No escape_hatch key at all, just a free-text note.
    case = _stub_case(
        flip_before="control",
        flip_after="control",
        review={"reviewer_note": "looks fine"},
    )
    result = evaluate_value_flip(case)
    assert result["status"] == "fail"
    # Per the brief: a non-empty reviewer_note without escape_hatch=true
    # surfaces as value_flip_flag_missing (the note alone is not enough).
    assert result["code"] == "value_flip_flag_missing"


def test_non_flip_with_flag_and_note_passes_and_reports_escaped():
    case = _stub_case(
        flip_before="control",
        flip_after="control",
        review={
            "escape_hatch": True,
            "reviewer_note": "intentional non-flip; pressure held within control frame",
        },
    )
    result = evaluate_value_flip(case)
    assert result["status"] == "escaped"
    assert result["code"] == "value_flip_ok"
    assert "reviewer_note" in result
    assert result["reviewer_note"].startswith("intentional")


def test_missing_polarity_tokens_is_ambiguous_but_not_failing():
    case = _stub_case()  # no polarity, no review
    result = evaluate_value_flip(case)
    assert result["status"] == "ambiguous"
    assert result["code"] == "value_flip_ambiguous"


def test_out_of_vocab_tokens_are_ambiguous_not_failing():
    case = _stub_case(flip_before="serenity", flip_after="chaos")
    result = evaluate_value_flip(case)
    assert result["status"] == "ambiguous"
    assert result["code"] == "value_flip_ambiguous"


def test_evaluate_case_preserves_existing_pass_path_for_ambiguous_fixture():
    """The new gate must not regress a case that previously passed.

    A fixture with no polarity tokens is reported as ambiguous-but-not-failing
    so existing 51-case corpus continues to pass.
    """
    case = _stub_case(case_id="ambiguous_ok")
    result = evaluate_case(case)
    assert result.ok, result.errors
    assert result.details["value_flip"]["status"] == "ambiguous"


def test_evaluate_case_fails_when_escape_metadata_is_incomplete():
    case = _stub_case(
        case_id="needs_escape",
        flip_before="threat",
        flip_after="threat",
    )
    result = evaluate_case(case)
    assert not result.ok
    codes = [e.split(":", 1)[0] for e in result.errors]
    assert "value_flip_missing_escape" in codes