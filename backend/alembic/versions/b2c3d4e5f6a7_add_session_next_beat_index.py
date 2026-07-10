"""add session next beat index

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-10 19:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Some early Supabase databases were created from SQLAlchemy metadata and
    # later gained ``current_mode`` manually, leaving the Alembic table empty
    # and the earlier server defaults absent. Re-applying these defaults is
    # idempotent and makes a verified baseline equivalent to revision a1b2.
    op.alter_column(
        "sessions",
        "current_mode",
        existing_type=sa.String(length=20),
        nullable=False,
        server_default=sa.text("'story'"),
    )
    op.alter_column(
        "character_dossiers",
        "trust_level",
        existing_type=sa.Integer(),
        nullable=False,
        server_default=sa.text("5"),
    )
    op.alter_column(
        "character_dossiers",
        "knowledge",
        existing_type=sa.Text(),
        nullable=False,
        server_default=sa.text("'{}'"),
    )
    op.alter_column(
        "character_dossiers",
        "relationship_notes",
        existing_type=sa.Text(),
        nullable=False,
        server_default=sa.text("''"),
    )
    op.add_column(
        "sessions",
        sa.Column(
            "next_beat_index",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("sessions", "next_beat_index")
