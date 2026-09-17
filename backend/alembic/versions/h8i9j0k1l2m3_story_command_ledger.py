"""Story world snapshots, idempotent commands and transactional public events."""

from alembic import op
import sqlalchemy as sa

revision = "h8i9j0k1l2m3"
down_revision = "g7h8i9j0k1l2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sessions", sa.Column("world_state", sa.Text(), nullable=True))
    op.add_column("sessions", sa.Column("world_revision", sa.Integer(), server_default="0", nullable=False))
    for name in ("pending_command_id", "last_command_id"):
        op.add_column("sessions", sa.Column(name, sa.String(80), nullable=True))
    op.add_column("sessions", sa.Column("generation_token", sa.String(36), nullable=True))
    op.add_column("sessions", sa.Column("generation_started_at", sa.DateTime(), nullable=True))
    op.create_table(
        "story_turns",
        sa.Column("session_id", sa.String(36), sa.ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("command_id", sa.String(80), primary_key=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("expected_revision", sa.Integer(), nullable=False),
        sa.Column("accepted_revision", sa.Integer(), nullable=True),
        sa.Column("parent_command_id", sa.String(80), nullable=True),
        sa.Column("snapshot_before", sa.Text(), nullable=False),
        sa.Column("snapshot_after", sa.Text(), nullable=True),
        sa.Column("events", sa.Text(), nullable=True),
        sa.Column("effects", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    # Server-only ledger: no direct anonymous/authenticated PostgREST policy.
    # The backend DB owner/service role retains access; HTTP ownership checks
    # are still required independently of RLS.
    if op.get_context().dialect.name == "postgresql":
        # ``world_state`` now puts the authoritative Story snapshot on the
        # pre-existing sessions table. Keep both halves of the ledger outside
        # the public Data API instead of protecting only story_turns.
        op.execute("ALTER TABLE sessions ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE story_turns ENABLE ROW LEVEL SECURITY")


def downgrade():
    if op.get_context().dialect.name == "postgresql":
        # This project did not enable RLS on the backend-only sessions table
        # before this migration, so restore the pre-migration posture.
        op.execute("ALTER TABLE sessions DISABLE ROW LEVEL SECURITY")
    op.drop_table("story_turns")
    for name in ("generation_started_at", "generation_token", "last_command_id",
                 "pending_command_id", "world_revision", "world_state"):
        op.drop_column("sessions", name)
