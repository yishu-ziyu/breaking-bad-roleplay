"""Startup schema guard: a database behind the Alembic head must abort startup.

SDD scenarios
-------------
Given a connected database whose ``alembic_version`` is older than the script
head, when the application starts, then startup logs an actionable migration
command (including ``uv run python -m alembic upgrade head``) and exits with a
non-zero status.

Given a database at head, or a situation with no usable database (APP_ENV=test,
running under pytest, non-PostgreSQL URL, unreachable server), then startup
proceeds with a quiet skip and the check never blocks unit tests.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
import sqlalchemy as sa

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test"
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

from db import schema_check  # noqa: E402
from db.schema_check import SchemaBehindError, ensure_schema_at_head  # noqa: E402


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, rows):
        self._rows = list(rows)

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakeConnection:
    def __init__(self, rows=None, error=None):
        self._rows = rows or []
        self._error = error

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def execute(self, statement):
        if self._error is not None:
            raise self._error
        return _FakeResult(self._rows)


class _FakeEngine:
    def __init__(self, connection):
        self._connection = connection
        self.disposed = False

    def connect(self):
        return self._connection

    def dispose(self):
        self.disposed = True


class _UnreachableEngine:
    def __init__(self, error):
        self.error = error
        self.disposed = False

    def connect(self):
        raise self.error

    def dispose(self):
        self.disposed = True


def _factory_for(engine):
    return lambda url: engine


def _unreachable_error() -> sa.exc.OperationalError:
    return sa.exc.OperationalError(
        "connect", {}, ConnectionRefusedError("connection refused")
    )


def _missing_table_error() -> sa.exc.ProgrammingError:
    return sa.exc.ProgrammingError(
        'SELECT version_num FROM alembic_version',
        {},
        Exception('relation "alembic_version" does not exist'),
    )


def _independent_migration_heads() -> set[str]:
    """Parse ``alembic/versions/*.py`` instead of trusting schema_check.

    A revision is a head when no other migration names it as ``down_revision``.
    """
    versions_dir = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    revisions: set[str] = set()
    parents: set[str] = set()
    for path in versions_dir.glob("*.py"):
        source = path.read_text()
        revision = re.search(r"^revision = ['\"]([^'\"]+)['\"]", source, re.M)
        if revision is None:
            continue
        revisions.add(revision.group(1))
        down = re.search(r"^down_revision = (.+)$", source, re.M)
        if down is not None:
            parents.update(re.findall(r"['\"]([^'\"]+)['\"]", down.group(1)))
    return revisions - parents


BEHIND_REVISION = "f0e1d2c3b4a5"


# ---------------------------------------------------------------------------
# Head detection
# ---------------------------------------------------------------------------


def test_expected_heads_is_derived_from_the_migration_scripts():
    assert set(schema_check.expected_heads()) == _independent_migration_heads()


def test_expected_heads_matches_alembic_script_directory():
    """Pin the ast parser against Alembic's own migration-graph reader."""
    alembic_config = pytest.importorskip("alembic.config")
    alembic_script = pytest.importorskip("alembic.script")

    config = alembic_config.Config()
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[1] / "alembic")
    )
    library_heads = set(
        alembic_script.ScriptDirectory.from_config(config).get_heads()
    )
    assert set(schema_check.expected_heads()) == library_heads


# ---------------------------------------------------------------------------
# Behind / at head
# ---------------------------------------------------------------------------


def test_database_at_head_passes():
    head = schema_check.expected_heads()
    engine = _FakeEngine(_FakeConnection(rows=list(reversed(head))))
    status = ensure_schema_at_head(
        "postgresql+asyncpg://u:p@localhost/db",
        skip_when_testing=False,
        engine_factory=_factory_for(engine),
    )
    assert status == "ok"
    assert engine.disposed is True


def test_behind_database_raises_actionable_error():
    engine = _FakeEngine(_FakeConnection(rows=[BEHIND_REVISION]))
    with pytest.raises(SchemaBehindError) as excinfo:
        ensure_schema_at_head(
            "postgresql+asyncpg://u:p@localhost/db",
            skip_when_testing=False,
            engine_factory=_factory_for(engine),
        )
    message = str(excinfo.value)
    assert "uv run python -m alembic upgrade head" in message
    assert BEHIND_REVISION in message
    assert schema_check.expected_heads()[0] in message


def test_error_message_names_the_broken_shebang_workaround():
    """The remediation must steer users away from the broken console script."""
    engine = _FakeEngine(_FakeConnection(rows=[BEHIND_REVISION]))
    with pytest.raises(SchemaBehindError) as excinfo:
        ensure_schema_at_head(
            "postgresql+asyncpg://u:p@localhost/db",
            skip_when_testing=False,
            engine_factory=_factory_for(engine),
        )
    assert "python -m alembic" in str(excinfo.value)


def test_fresh_database_without_alembic_version_is_behind():
    engine = _FakeEngine(_FakeConnection(error=_missing_table_error()))
    with pytest.raises(SchemaBehindError) as excinfo:
        ensure_schema_at_head(
            "postgresql+asyncpg://u:p@localhost/db",
            skip_when_testing=False,
            engine_factory=_factory_for(engine),
        )
    message = str(excinfo.value)
    assert "uv run python -m alembic upgrade head" in message
    assert "never been migrated" in message


# ---------------------------------------------------------------------------
# Quiet skips
# ---------------------------------------------------------------------------


def test_app_env_test_skips_without_connecting():
    def exploding_factory(url):
        raise AssertionError("must not connect when APP_ENV=test")

    status = ensure_schema_at_head(
        "postgresql+asyncpg://u:p@localhost/db",
        app_env="test",
        skip_when_testing=False,
        engine_factory=exploding_factory,
    )
    assert status == "skipped:test-env"


def test_pytest_process_skips_without_connecting(monkeypatch):
    monkeypatch.setenv("PYTEST_CURRENT_TEST", "test_schema_version_check.py")
    called = False

    def factory(url):
        nonlocal called
        called = True
        return _FakeEngine(_FakeConnection())

    status = ensure_schema_at_head(
        "postgresql+asyncpg://u:p@localhost/db",
        app_env="development",
        engine_factory=factory,
    )
    assert status == "skipped:test-process"
    assert called is False


def test_non_postgres_url_skips_without_connecting():
    def exploding_factory(url):
        raise AssertionError("must not connect for a non-PostgreSQL URL")

    status = ensure_schema_at_head(
        "sqlite+aiosqlite:///tmp/test.db",
        app_env="development",
        skip_when_testing=False,
        engine_factory=exploding_factory,
    )
    assert status == "skipped:non-postgres"


def test_unreachable_database_skips_quietly():
    engine = _UnreachableEngine(_unreachable_error())
    status = ensure_schema_at_head(
        "postgresql+asyncpg://u:p@localhost/db",
        app_env="development",
        skip_when_testing=False,
        engine_factory=_factory_for(engine),
    )
    assert status == "skipped:unreachable"
    assert engine.disposed is True


def test_connect_time_programming_error_skips_quietly():
    """e.g. an asyncpg-only URL parameter that libpq refuses."""
    engine = _UnreachableEngine(
        sa.exc.ProgrammingError(
            "connect", {}, Exception('invalid connection option "ssl"')
        )
    )
    status = ensure_schema_at_head(
        "postgresql+asyncpg://u:p@localhost/db?ssl=require",
        app_env="development",
        skip_when_testing=False,
        engine_factory=_factory_for(engine),
    )
    assert status == "skipped:unreachable"


def test_missing_sync_driver_skips_quietly():
    def factory(url):
        raise ModuleNotFoundError("No module named 'psycopg2'")

    status = ensure_schema_at_head(
        "postgresql+asyncpg://u:p@localhost/db",
        app_env="development",
        skip_when_testing=False,
        engine_factory=factory,
    )
    assert status == "skipped:no-sync-driver"


# ---------------------------------------------------------------------------
# main.lifespan wiring: behind schema -> non-zero exit
# ---------------------------------------------------------------------------


def test_main_lifespan_aborts_when_schema_is_behind(monkeypatch):
    import asyncio

    import main

    def boom(*args, **kwargs):
        raise SchemaBehindError(
            "Database schema is out of date. Run: uv run python -m alembic upgrade head"
        )

    monkeypatch.setattr(main, "ensure_schema_at_head", boom)

    async def run_startup():
        async with main.lifespan(main.app):
            pass  # pragma: no cover — must never be reached

    with pytest.raises(SystemExit) as excinfo:
        asyncio.run(run_startup())
    assert excinfo.value.code not in (0, None)
