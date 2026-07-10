"""Deployment-shaped tests for the Vercel FastAPI entrypoint."""

from __future__ import annotations

import os
from pathlib import Path
import json
import tomllib
import subprocess
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]


def _requirements(path: Path) -> list[str]:
    return [
        line.strip()
        for line in path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def test_vercel_pyproject_matches_backend_runtime_dependencies() -> None:
    """The root Vercel Python project must stay aligned with the backend."""

    project = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text())["project"]
    assert project["dependencies"] == _requirements(
        REPO_ROOT / "backend" / "requirements.txt"
    )
    assert project["requires-python"] == ">=3.12,<3.13"


def test_vercel_function_bundle_excludes_local_environment_files() -> None:
    config = json.loads((REPO_ROOT / "vercel.json").read_text())
    excluded = config["functions"]["api/index.py"]["excludeFiles"]

    assert ".env*" in excluded
    assert "**/.env*" in excluded


def test_vercel_entrypoint_exports_authoritative_fastapi_routes() -> None:
    """A clean root import must expose the complete backend contract."""

    script = """
import runpy

namespace = runpy.run_path('api/index.py')
app = namespace['app']
paths = set(app.openapi()['paths'])
required = {
    '/api/health',
    '/api/chat',
    '/api/session/create',
    '/api/session/{session_id}/stream',
    '/api/session/{session_id}/messages',
}
missing = required - paths
assert not missing, f'missing FastAPI routes: {sorted(missing)}'
"""
    env = os.environ.copy()
    env.update(
        {
            "STEPFUN_API_KEY": "test-key",
            "DATABASE_URL": "postgresql+asyncpg://test:test@localhost:5432/test",
            "APP_ENV": "test",
            "ALLOWED_ORIGINS": "*",
        }
    )

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
