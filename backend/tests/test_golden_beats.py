"""Golden Beat hard + soft harness — 50-case batch must stay green."""

from __future__ import annotations

from eval.golden_harness import evaluate_case, load_golden_cases, run_all, summary


def test_golden_batch_loads_fifty():
    cases = load_golden_cases()
    assert len(cases) >= 51
    ids = {c["id"] for c in cases}
    assert "gb_001_walter_saul_leverage" in ids
    assert "gb_002_skyler_knowledge_boundary" in ids
    assert "gb_051_walter_s1_money_quit" in ids
    assert any(i.startswith("gb_050") for i in ids)


def test_all_golden_cases_pass_hard_and_soft_harness():
    results = run_all()
    s = summary(results)
    assert s["failed"] == 0, s["failures"]
    assert s["passed"] == s["total"]
    assert s["total"] >= 50


def test_knowledge_case_isolates_codes():
    cases = {c["id"]: c for c in load_golden_cases()}
    r = evaluate_case(cases["gb_002_skyler_knowledge_boundary"])
    assert r.ok
    assert r.details["a"]["ok"] is True
    assert "knowledge_boundary" in r.details["b"]["error_codes"]


def test_soft_only_case_ranks_preferred():
    cases = {c["id"]: c for c in load_golden_cases()}
    # gb_005 both hard-pass; preferred a
    r = evaluate_case(cases["gb_005_mike_discipline"])
    assert r.ok
    soft = r.details.get("soft")
    assert soft is not None
    assert soft["a"] >= soft["b"]


def test_s1_money_quit_golden_prefers_family_mask():
    cases = {c["id"]: c for c in load_golden_cases()}
    r = evaluate_case(cases["gb_051_walter_s1_money_quit"])
    assert r.ok, r.errors
    soft = r.details.get("soft")
    assert soft is not None
    assert soft["a"] > soft["b"]
    assert soft["pick"] == "a"
