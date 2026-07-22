"""Golden Beat hard harness — first batch must stay green."""

from __future__ import annotations

from eval.golden_harness import evaluate_case, load_golden_cases, run_all, summary


def test_golden_batch_loads_at_least_twelve():
    cases = load_golden_cases()
    assert len(cases) >= 12
    ids = {c["id"] for c in cases}
    assert "gb_001_walter_saul_leverage" in ids
    assert "gb_002_skyler_knowledge_boundary" in ids


def test_all_golden_cases_pass_hard_harness():
    results = run_all()
    s = summary(results)
    assert s["failed"] == 0, s["failures"]
    assert s["passed"] == s["total"]
    assert s["total"] >= 12


def test_knowledge_case_isolates_codes():
    cases = {c["id"]: c for c in load_golden_cases()}
    r = evaluate_case(cases["gb_002_skyler_knowledge_boundary"])
    assert r.ok
    assert r.details["a"]["ok"] is True
    assert "knowledge_boundary" in r.details["b"]["error_codes"]
