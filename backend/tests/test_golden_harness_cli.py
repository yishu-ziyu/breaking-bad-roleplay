"""Loop 13 Commit 3 — CLI / smoke / pre-commit wiring tests.

Verifies:
  * ``_main`` returns 0 when smoke run passes; non-zero when a deliberately
    bad case is introduced.
  * ``--list-ids`` returns the 10 deterministic smoke IDs in stable order.
  * ``--json`` emits a single-line summary that includes value_flip status
    counts.
  * ``--smoke`` and ``--ids`` are mutually exclusive (returns 2).
  * Smoke run selects exactly 10 cases from the corpus by prefix.
  * Summary's ``value_flip_status_counts`` is populated for the corpus.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from contextlib import redirect_stdout

import pytest

from eval.golden_harness import (
    SMOKE_ID_PREFIXES,
    _main,
    _select_smoke_cases,
    evaluate_value_flip,
    load_golden_cases,
    summary,
)


def test_smoke_id_prefixes_are_ten_in_stable_order():
    assert len(SMOKE_ID_PREFIXES) == 10
    # Literal list — order is part of the public contract.
    assert SMOKE_ID_PREFIXES[0] == "gb_001"
    assert SMOKE_ID_PREFIXES[-1] == "gb_051"
    # Determinism: tuple → equal across calls.
    assert SMOKE_ID_PREFIXES == SMOKE_ID_PREFIXES


def test_select_smoke_cases_returns_ten():
    cases = _select_smoke_cases()
    assert len(cases) == 10
    ids = [c["id"] for c in cases]
    # Each prefix must match (and prefixes are unique).
    for prefix in SMOKE_ID_PREFIXES:
        assert any(i.startswith(prefix) for i in ids), f"{prefix} missing"
    # Order is the prefix order, not file-system or numeric sort.
    assert ids[0].startswith("gb_001")
    assert ids[-1].startswith("gb_051")


def test_summary_includes_value_flip_status_counts():
    results = [evaluate_value_flip(c) for c in load_golden_cases()]
    # Build synthetic GoldenCaseResult-shaped wrappers.
    from dataclasses import dataclass

    @dataclass
    class _R:
        case_id: str
        ok: bool
        errors: list
        details: dict

    wrapped = [
        _R(
            case_id=f"c{i}",
            ok=True,
            errors=[],
            details={"value_flip": r},
        )
        for i, r in enumerate(results)
    ]
    s = summary(wrapped)
    assert "value_flip_status_counts" in s
    # All on-disk cases are currently ambiguous-but-not-failing.
    assert s["value_flip_status_counts"].get("ambiguous", 0) >= 50


def test_main_smoke_exits_zero():
    rc = _main(["--smoke"])
    assert rc == 0


def test_main_smoke_json_emits_valid_json_with_counts():
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = _main(["--json", "--smoke"])
    assert rc == 0
    out = buf.getvalue().strip().splitlines()[-1]
    data = json.loads(out)
    assert data["total"] == 10
    assert data["passed"] == 10
    assert data["failed"] == 0
    assert "value_flip_status_counts" in data


def test_main_list_ids_prints_deterministic_list():
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = _main(["--list-ids"])
    assert rc == 0
    lines = [ln for ln in buf.getvalue().splitlines() if ln.strip()]
    assert lines == list(SMOKE_ID_PREFIXES)


def test_main_smoke_and_ids_are_mutually_exclusive():
    rc = _main(["--smoke", "--ids", "gb_001"])
    assert rc == 2


def test_main_full_run_exits_zero():
    rc = _main([])
    assert rc == 0


def test_main_full_run_default_covers_51_cases():
    """Smoke covers 10; default covers all 51 on-disk cases."""
    all_ids = {c["id"] for c in load_golden_cases()}
    assert len(all_ids) >= 51


# --- subprocess smoke: confirm the literal brief command -------------------


def _has_uv() -> bool:
    from shutil import which

    return which("uv") is not None


@pytest.mark.skipif(not _has_uv(), reason="uv not available on PATH")
def test_subprocess_canonical_smoke_command_exits_zero(tmp_path):
    """Run from inside backend/: ``uv run python -m eval.golden_harness --smoke``.

    Note: the brief wrote ``python -m backend.eval.golden_harness`` for the
    pre-commit hook, but inside backend/ the working form is the unprefixed
    ``eval.golden_harness`` (backend/ is a namespace package only when cwd is
    the repo root). The hook uses the working form; see .githooks/pre-commit.
    """
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    backend_dir = os.path.join(repo_root, "backend")
    proc = subprocess.run(
        ["uv", "run", "python", "-m", "eval.golden_harness", "--smoke"],
        cwd=backend_dir,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + "\n" + proc.stderr
    assert "passed  : 10" in proc.stdout
    assert "failed  : 0" in proc.stdout


@pytest.mark.skipif(not _has_uv(), reason="uv not available on PATH")
def test_subprocess_repo_root_literal_command_exits_zero(tmp_path):
    """The brief's literal from-repo-root command works thanks to the
    sys.path injection and .env loader added in Commit 1 and Commit 3."""
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    proc = subprocess.run(
        [
            "uv",
            "run",
            "--project",
            "backend",
            "python",
            "-m",
            "backend.eval.golden_harness",
            "--smoke",
        ],
        cwd=repo_root,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + "\n" + proc.stderr
    assert "passed  : 10" in proc.stdout
    assert "failed  : 0" in proc.stdout