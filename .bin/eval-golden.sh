#!/usr/bin/env bash
# Repo-root convenience wrapper for the golden harness.
#
# The canonical invocation is `cd backend && uv run python -m
# eval.golden_harness [--smoke]`. This wrapper does the `cd backend` for
# you so the eval subprocess picks up backend/.env automatically.
#
# Why `eval.golden_harness` (no `backend.` prefix): inside `backend/`,
# the `backend` directory has no `__init__.py`, so it isn't importable as
# a regular package from this cwd. The unprefixed form works because
# `eval/` is a regular package (has `__init__.py`).
#
# If you actually want to run from the repo root, use:
#   uv run --project backend python -m backend.eval.golden_harness ...
# — that path works because `backend/` is a namespace package at the
# repo root.
#
# Usage:
#   ./.bin/eval-golden.sh --smoke
#   ./.bin/eval-golden.sh             # full run (51 cases)
#   ./.bin/eval-golden.sh --list-ids
#   ./.bin/eval-golden.sh --json --smoke

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/backend"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found on PATH; install uv (https://docs.astral.sh/uv/)" >&2
  exit 1
fi

exec uv run python -m eval.golden_harness "$@"