"""The migration is exercised against a disposable DB, never the configured DB."""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def migration():
    path = Path(__file__).parents[1] / "alembic/versions/h8i9j0k1l2m3_story_command_ledger.py"
    spec = importlib.util.spec_from_file_location("story_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_story_migration_upgrades_and_downgrades_without_losing_existing_sessions():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE sessions (id VARCHAR(36) PRIMARY KEY, title TEXT)"))
        connection.execute(sa.text("INSERT INTO sessions (id,title) VALUES ('old','existing story')"))
        with Operations.context(MigrationContext.configure(connection)):
            migration().upgrade()
        inspector = sa.inspect(connection)
        assert "story_turns" in inspector.get_table_names()
        assert "world_state" in {c["name"] for c in inspector.get_columns("sessions")}
        assert connection.execute(sa.text("SELECT world_state FROM sessions WHERE id='old'")).scalar() is None
        with Operations.context(MigrationContext.configure(connection)):
            migration().downgrade()
        assert "story_turns" not in sa.inspect(connection).get_table_names()
        assert connection.execute(sa.text("SELECT title FROM sessions WHERE id='old'")).scalar() == "existing story"
    engine.dispose()


def test_postgres_ledger_is_not_readable_through_unauthorized_data_api():
    import io
    output = io.StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        migration().upgrade()
    assert "ALTER TABLE story_turns ENABLE ROW LEVEL SECURITY" in output.getvalue()
    assert "ALTER TABLE sessions ENABLE ROW LEVEL SECURITY" in output.getvalue()

    downgrade_output = io.StringIO()
    downgrade_context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": downgrade_output},
    )
    with Operations.context(downgrade_context):
        migration().downgrade()
    assert "ALTER TABLE sessions DISABLE ROW LEVEL SECURITY" in downgrade_output.getvalue()
