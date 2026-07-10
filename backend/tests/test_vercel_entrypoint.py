"""Deployment-shaped tests for the Vercel FastAPI entrypoint."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]


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
