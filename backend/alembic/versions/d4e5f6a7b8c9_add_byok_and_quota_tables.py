"""add byok_connections audit table + durable quota counters

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "byok_connections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("provider_id", sa.String(length=40), nullable=False),
        sa.Column("model_id", sa.String(length=100), nullable=True),
        sa.Column("base_url", sa.String(length=300), nullable=True),
        sa.Column("region", sa.String(length=20), nullable=True),
        sa.Column("key_hint", sa.String(length=16), nullable=True),
        sa.Column("has_llm_key", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("has_tts_key", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_epoch", sa.Integer(), nullable=False),
        sa.Column("expires_epoch", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_byok_connections")),
    )
    op.create_table(
        "quota_usage",
        sa.Column("day", sa.String(length=10), nullable=False),
        sa.Column("identity", sa.String(length=191), nullable=False),
        sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("day", "identity", name=op.f("pk_quota_usage")),
    )
    op.create_table(
        "quota_usage_global",
        sa.Column("day", sa.String(length=10), nullable=False),
        sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("day", name=op.f("pk_quota_usage_global")),
    )


def downgrade() -> None:
    op.drop_table("quota_usage_global")
    op.drop_table("quota_usage")
    op.drop_table("byok_connections")
