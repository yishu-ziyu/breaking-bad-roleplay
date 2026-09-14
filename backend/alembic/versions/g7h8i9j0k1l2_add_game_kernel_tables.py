"""add game kernel tables

Revision ID: g7h8i9j0k1l2
Revises: d4e5f6a7b8c9
Create Date: 2026-09-14 18:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "g7h8i9j0k1l2"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "game_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner", sa.String(80), nullable=False, server_default="guest"),
        sa.Column("scenario_id", sa.String(80), nullable=False, server_default="one_night_v1"),
        sa.Column("rules_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("seed", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("state_json", sa.Text(), nullable=False),
        sa.Column("parent_run_id", sa.String(36), nullable=True),
        sa.Column("parent_revision", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "game_actions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("action_id", sa.String(80), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("expected_revision", sa.Integer(), nullable=False),
        sa.Column("accepted_revision", sa.Integer(), nullable=False),
        sa.Column("choice_id", sa.String(80), nullable=False),
        sa.Column("accepted_view_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("run_id", "action_id", name="uq_game_actions_run_action"),
    )
    op.create_index("ix_game_actions_run_id", "game_actions", ["run_id"])
    op.create_table(
        "game_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(40), nullable=False),
        sa.Column("visibility", sa.String(20), nullable=False, server_default="player"),
        sa.Column("source_action_id", sa.String(80), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("run_id", "seq", name="uq_game_events_run_seq"),
    )
    op.create_index("ix_game_events_run_id", "game_events", ["run_id"])
    op.create_table(
        "game_checkpoints",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("state_json", sa.Text(), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("parent_run_id", sa.String(36), nullable=True),
        sa.Column("source_action_id", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("run_id", "revision", name="uq_game_checkpoints_run_rev"),
    )
    op.create_index("ix_game_checkpoints_run_id", "game_checkpoints", ["run_id"])
    op.create_table(
        "performance_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("action_id", sa.String(80), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("kind", sa.String(40), nullable=False, server_default="performance"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_performance_jobs_run_id", "performance_jobs", ["run_id"])


def downgrade() -> None:
    op.drop_table("performance_jobs")
    op.drop_table("game_checkpoints")
    op.drop_table("game_events")
    op.drop_table("game_actions")
    op.drop_table("game_runs")
