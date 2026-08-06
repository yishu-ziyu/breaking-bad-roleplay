"""Promptfoo CI gate runner for golden beats harness.

This is the promptfoo provider entrypoint. It runs the full golden beats
suite and exits with code 0 only if the pass rate meets the 90% threshold.

Usage (from repo root):
    cd backend && uv run python -m eval.promptfoo_runner

Invoked by `promptfooconfig.yaml` via the `exec` provider.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Ensure backend/ is on sys.path so that `eval.golden_harness` resolves
# regardless of the working directory promptfoo uses.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from eval.golden_harness import run_all, summary

THRESHOLD = 0.9


def _main() -> int:
    results = run_all()
    s = summary(results)
    total = s["total"]
    passed = s["passed"]
    rate = passed / total if total > 0 else 0.0

    report = {
        "total": total,
        "passed": passed,
        "failed": s["failed"],
        "pass_rate": round(rate, 4),
        "threshold": THRESHOLD,
        "meets_threshold": rate >= THRESHOLD,
        "failed_ids": s["failed_ids"],
        "failures": s["failures"],
        "value_flip_status_counts": s.get("value_flip_status_counts", {}),
    }

    print(json.dumps(report, indent=2, ensure_ascii=False))
    print(
        f"\nGolden beats: {passed}/{total} passed ({rate:.1%}), "
        f"threshold={THRESHOLD:.0%}",
    )

    if rate < THRESHOLD:
        print(f"FAIL: pass rate {rate:.1%} below {THRESHOLD:.0%} threshold")
        return 1

    print(f"PASS: pass rate {rate:.1%} meets {THRESHOLD:.0%} threshold")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())