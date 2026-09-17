"""Lock remaining backend-owned tables behind PostgreSQL RLS.

The browser must reach these rows only through FastAPI ownership / quota
checks. No anon or authenticated PostgREST policy is created. The migration
connection owns the tables, so the backend database role keeps normal access.

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
"""

from alembic import op


revision = "i9j0k1l2m3n4"
down_revision = "h8i9j0k1l2m3"
branch_labels = None
depends_on = None


# `sessions` and `story_turns` are already locked by h8i9j0k1l2m3. Keep this
# list to tables whose pre-migration state was RLS-off so downgrade is honest.
SERVER_ONLY_TABLES = (
    "messages",
    "character_states",
    "character_dossiers",
    "byok_connections",
    "quota_usage",
    "quota_usage_global",
    "game_runs",
    "game_actions",
    "game_events",
    "game_checkpoints",
    "performance_jobs",
)


def upgrade() -> None:
    if op.get_context().dialect.name != "postgresql":
        return
    for table in SERVER_ONLY_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    if op.get_context().dialect.name != "postgresql":
        return
    for table in reversed(SERVER_ONLY_TABLES):
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
