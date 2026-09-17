"""Backend-owned tables must never be directly readable through PostgREST."""

import importlib.util
import io
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations


def migration():
    path = (
        Path(__file__).parents[1]
        / "alembic/versions/i9j0k1l2m3n4_lock_server_tables_rls.py"
    )
    spec = importlib.util.spec_from_file_location("server_table_rls", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def render(method: str) -> str:
    output = io.StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    with Operations.context(context):
        getattr(migration(), method)()
    return output.getvalue()


def test_all_backend_owned_tables_enable_rls_without_public_policies():
    sql = render("upgrade")
    for table in migration().SERVER_ONLY_TABLES:
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql
    assert "CREATE POLICY" not in sql


def test_downgrade_restores_the_previous_rls_state():
    sql = render("downgrade")
    for table in migration().SERVER_ONLY_TABLES:
        assert f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY" in sql
