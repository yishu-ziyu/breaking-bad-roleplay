"""fix nullable columns

Aligns the ``character_dossiers`` table with the SQLAlchemy model in
db/models.py. The initial schema (f1a2b3c4d5e6) created ``trust_level``,
``knowledge`` and ``relationship_notes`` as ``nullable=True`` with no
``server_default``, while the model declares them non-nullable with
Python-side defaults (``trust_level=5``, ``knowledge='{}'``,
``relationship_notes=''``).

Raw SQL inserts (or any path that bypasses the ORM) could therefore write
NULL into these columns, which later caused ``TypeError`` at runtime in
agents/memory.py (e.g. ``dossier.trust_level + trust_delta`` on ``None``).

This migration:
  1. Backfills any existing NULL rows with the model defaults so the
     NOT NULL constraint can be applied without failing.
  2. Alters the three columns to ``NOT NULL`` with a ``server_default``
     matching the model, so future raw inserts also stay consistent.

Revision ID: e5f6a7b8c9d0
Revises: f1a2b3c4d5e6
Create Date: 2026-06-28 23:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Make trust_level/knowledge/relationship_notes NOT NULL with defaults."""
    # 1. Backfill existing NULL rows so the NOT NULL constraint can apply.
    #    Use the model's defaults so the data matches what the ORM would have
    #    written. server_default alone does not retroactively fill NULLs.
    op.execute(
        "UPDATE character_dossiers SET trust_level = 5 WHERE trust_level IS NULL"
    )
    op.execute(
        "UPDATE character_dossiers SET knowledge = '{}' WHERE knowledge IS NULL"
    )
    op.execute(
        "UPDATE character_dossiers SET relationship_notes = '' "
        "WHERE relationship_notes IS NULL"
    )

    # 2. Alter columns to NOT NULL with server_default matching the model.
    #    server_default keeps future raw SQL inserts consistent with the ORM.
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


def downgrade() -> None:
    """Revert columns to nullable=True with no server_default."""
    op.alter_column(
        "character_dossiers",
        "relationship_notes",
        existing_type=sa.Text(),
        nullable=True,
        server_default=None,
    )
    op.alter_column(
        "character_dossiers",
        "knowledge",
        existing_type=sa.Text(),
        nullable=True,
        server_default=None,
    )
    op.alter_column(
        "character_dossiers",
        "trust_level",
        existing_type=sa.Integer(),
        nullable=True,
        server_default=None,
    )
