"""Startup guard: refuse to serve when the database schema is behind Alembic.

``main.lifespan`` no longer creates tables (schema is owned exclusively by
Alembic). Without a guard, a database at an old revision only fails later,
mid-request, with confusing errors such as
``UndefinedColumnError: column "world_state" of relation "sessions" does not
exist`` (an old DB at ``g7h8i9j0k1l2`` vs a code head that already expects the
story-ledger migration).

This module compares the revision recorded in ``alembic_version`` with the
script-directory head. On mismatch it raises :class:`SchemaBehindError` with an
actionable remediation message; ``main`` turns that into a non-zero exit.

The head is computed by parsing ``alembic/versions/*.py`` with :mod:`ast`
instead of importing the alembic library, so the guard also works when the
process was started on an interpreter that cannot import alembic (on this
machine the venv console scripts have a stale shebang, and ``uv run uvicorn``
falls back to the Homebrew Python, which has SQLAlchemy/psycopg2 but not the
alembic package). Tests pin the parser against Alembic's ScriptDirectory.

The check is deliberately quiet when there is nothing to check: test runs
(APP_ENV=test or any pytest process), non-PostgreSQL URLs, a missing sync DB
driver and an unusable/missing database connection all skip with a debug/info
log instead of blocking startup, so unit tests and DB-less development keep
working exactly as before.
"""

from __future__ import annotations

import ast
import logging
import os
import sys
from pathlib import Path
from typing import Callable

import sqlalchemy as sa
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.pool import NullPool

from db.url import render_engine_url

logger = logging.getLogger(__name__)

# Console scripts installed by uv/venv use an absolute shebang. When that
# shebang is stale or contains a space (e.g. the repo path moved to
# ".../AI 产品/breaking-bad-roleplay") `uv run alembic` dies with
# "Failed to spawn: alembic". `python -m alembic` never touches the shebang.
UPGRADE_COMMAND = "uv run python -m alembic upgrade head"

_MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "alembic"


class SchemaBehindError(RuntimeError):
    """The connected database's Alembic revision differs from the script head."""


def _literal_str(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _down_revisions(node: ast.AST) -> set[str]:
    if isinstance(node, ast.Constant):
        value = _literal_str(node)
        return {value} if value else set()
    if isinstance(node, (ast.Tuple, ast.List)):
        return {value for elt in node.elts if (value := _literal_str(elt))}
    return set()


def expected_heads(migrations_dir: Path | None = None) -> tuple[str, ...]:
    """Return the revision ids that the migration scripts consider head.

    Mirrors Alembic's ScriptDirectory semantics for this repository: a
    revision is a head when no other migration lists it as ``down_revision``.
    """
    versions_dir = (migrations_dir or _MIGRATIONS_DIR) / "versions"
    revisions: set[str] = set()
    parents: set[str] = set()
    for path in sorted(versions_dir.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if not isinstance(node, ast.Assign) or len(node.targets) != 1:
                continue
            target = node.targets[0]
            if not isinstance(target, ast.Name):
                continue
            if target.id == "revision":
                revision = _literal_str(node.value)
                if revision:
                    revisions.add(revision)
            elif target.id == "down_revision":
                parents |= _down_revisions(node.value)
    return tuple(sorted(revisions - parents))


def _sync_url(database_url: str):
    url = make_url(database_url)
    if url.get_backend_name() == "postgresql" and "+asyncpg" in url.drivername:
        url = url.set(drivername="postgresql+psycopg2")
    return url


def read_database_revision(engine) -> tuple[str, ...]:
    """Read ``alembic_version`` rows; a missing table means "never migrated"."""
    with engine.connect() as connection:
        try:
            rows = (
                connection.execute(text("SELECT version_num FROM alembic_version"))
                .scalars()
                .all()
            )
        except sa.exc.ProgrammingError:
            return ()
    return tuple(str(row) for row in rows)


def describe_mismatch(current: tuple[str, ...], expected: tuple[str, ...]) -> str:
    """Actionable message: what was found, what is required, how to fix it."""
    if current:
        found = ", ".join(sorted(current))
    else:
        found = "no alembic_version row (database has never been migrated)"
    wanted = ", ".join(sorted(expected)) or "<no migration scripts found>"
    return (
        f"Database schema is out of date: found revision(s) [{found}], "
        f"but the migration scripts are at head [{wanted}].\n"
        "Refusing to start: the app assumes the code's schema and would fail "
        'mid-request (e.g. UndefinedColumnError: column "world_state" does not exist).\n'
        "Apply the migrations, then start the app again:\n"
        f"    cd backend && {UPGRADE_COMMAND}\n"
        "If `uv run alembic ...` fails with \"Failed to spawn: alembic\" because "
        "the repository path contains spaces, use `python -m alembic` as above "
        "to bypass the broken console-script shebang."
    )


def _running_under_pytest() -> bool:
    return "pytest" in sys.modules or "PYTEST_CURRENT_TEST" in os.environ


def ensure_schema_at_head(
    database_url: str,
    *,
    app_env: str = "development",
    connect_timeout: int = 5,
    skip_when_testing: bool = True,
    engine_factory: Callable[[str], object] | None = None,
) -> str:
    """Verify the database revision; raise :class:`SchemaBehindError` if stale.

    Returns a status string: ``"ok"`` or ``"skipped:<reason>"``. *engine_factory*
    exists for tests (it receives the sync URL); production builds a psycopg2
    engine with a short connect timeout. ``skip_when_testing`` disables only the
    pytest-process detection (APP_ENV=test always skips) so unit tests can
    exercise the real comparison logic.
    """
    if app_env.strip().lower() == "test":
        logger.debug("APP_ENV=test — skipping the database schema version check")
        return "skipped:test-env"
    if skip_when_testing and _running_under_pytest():
        logger.debug("running under pytest — skipping the database schema version check")
        return "skipped:test-process"
    if not (database_url or "").strip():
        logger.debug("no DATABASE_URL configured — skipping the database schema check")
        return "skipped:no-url"

    url = _sync_url(database_url)
    if url.get_backend_name() != "postgresql":
        logger.info(
            "DATABASE_URL backend is %s (not PostgreSQL) — skipping the schema check",
            url.get_backend_name(),
        )
        return "skipped:non-postgres"

    safe_url = url.render_as_string(hide_password=True)
    engine = None
    try:
        try:
            if engine_factory is not None:
                engine = engine_factory(render_engine_url(url))
            else:
                engine = create_engine(
                    render_engine_url(url),
                    poolclass=NullPool,
                    connect_args={"connect_timeout": connect_timeout},
                )
            current = read_database_revision(engine)
        except ModuleNotFoundError as exc:
            # e.g. a Python without the sync driver (psycopg2) installed:
            # nothing to check with, so stay quiet.
            logger.info(
                "sync DB driver unavailable (%s) — skipping the schema check", exc
            )
            return "skipped:no-sync-driver"
        except (
            sa.exc.OperationalError,
            sa.exc.InterfaceError,
            sa.exc.ProgrammingError,
        ) as exc:
            # No usable DB (server down, wrong host/credentials, asyncpg-only
            # URL parameters libpq refuses, …): stay quiet and let the app
            # start; requests that need the DB surface their own errors,
            # exactly as before this guard existed. (A missing alembic_version
            # table does not land here — read_database_revision returns () for
            # that case, which is treated as "behind".)
            logger.info(
                "database %s unusable during the startup schema check (%s) — "
                "skipping the version check",
                safe_url,
                exc.__class__.__name__,
            )
            return "skipped:unreachable"
    finally:
        if engine is not None:
            engine.dispose()

    heads = expected_heads()
    if set(current) == set(heads):
        logger.info(
            "DB schema at migration head: %s", ", ".join(heads) or "(none)"
        )
        return "ok"

    raise SchemaBehindError(describe_mismatch(current, heads))
