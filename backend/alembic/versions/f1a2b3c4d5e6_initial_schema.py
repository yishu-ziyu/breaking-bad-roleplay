"""initial schema

Creates the four core tables — sessions, messages, character_states,
character_dossiers — matching the current SQLAlchemy models in db/models.py.

This migration is idempotent with ``Base.metadata.create_all``: both produce
the same schema. Existing databases that were bootstrapped via ``create_all``
should be stamped with ``alembic stamp head`` so this migration is recorded
as applied without re-running the DDL.

Revision ID: f1a2b3c4d5e6
Revises:
Create Date: 2026-06-28 22:38:03.315904

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the initial schema (sessions, messages, character_states, character_dossiers)."""
    # sessions — top-level entity; other tables FK into it with ON DELETE CASCADE.
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("active_character_id", sa.String(length=50), nullable=True),
        sa.Column("task_prompt", sa.Text(), nullable=True),
        sa.Column("plot_outline", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # messages — chat messages belonging to a session.
    op.create_table(
        "messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("character_name", sa.String(length=50), nullable=True),
        sa.Column("emotion_state", sa.String(length=50), nullable=True),
        sa.Column("gif_search_query", sa.String(length=200), nullable=True),
        sa.Column("beat_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_messages_session_id"), "messages", ["session_id"], unique=False
    )

    # character_states — per-session emotional/location state of a character.
    op.create_table(
        "character_states",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.Column("character_id", sa.String(length=50), nullable=False),
        sa.Column("current_emotion", sa.String(length=50), nullable=True),
        sa.Column("location", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=100), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_character_states_session_id"),
        "character_states",
        ["session_id"],
        unique=False,
    )

    # character_dossiers — what one character knows about another in a session.
    op.create_table(
        "character_dossiers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.Column("owner_id", sa.String(length=50), nullable=False),
        sa.Column("subject_id", sa.String(length=50), nullable=False),
        sa.Column("trust_level", sa.Integer(), nullable=True),
        sa.Column("knowledge", sa.Text(), nullable=True),
        sa.Column("relationship_notes", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_character_dossiers_session_id"),
        "character_dossiers",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_character_dossiers_owner_id"),
        "character_dossiers",
        ["owner_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_character_dossiers_subject_id"),
        "character_dossiers",
        ["subject_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop all tables in reverse dependency order."""
    op.drop_index(op.f("ix_character_dossiers_subject_id"), table_name="character_dossiers")
    op.drop_index(op.f("ix_character_dossiers_owner_id"), table_name="character_dossiers")
    op.drop_index(op.f("ix_character_dossiers_session_id"), table_name="character_dossiers")
    op.drop_table("character_dossiers")

    op.drop_index(op.f("ix_character_states_session_id"), table_name="character_states")
    op.drop_table("character_states")

    op.drop_index(op.f("ix_messages_session_id"), table_name="messages")
    op.drop_table("messages")

    op.drop_table("sessions")
