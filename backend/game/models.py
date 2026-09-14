"""SQLAlchemy rows for the night kernel. Sole ORM for the five game tables."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from db.session import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class GameRun(Base):
    __tablename__ = "game_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner: Mapped[str] = mapped_column(String(80), nullable=False, default="guest")
    scenario_id: Mapped[str] = mapped_column(String(80), nullable=False, default="one_night_v1")
    rules_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    seed: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    state_json: Mapped[str] = mapped_column(Text, nullable=False)
    parent_run_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    parent_revision: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=False
    )


class GameAction(Base):
    __tablename__ = "game_actions"
    __table_args__ = (UniqueConstraint("run_id", "action_id", name="uq_game_actions_run_action"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    action_id: Mapped[str] = mapped_column(String(80), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expected_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    accepted_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    choice_id: Mapped[str] = mapped_column(String(80), nullable=False)
    accepted_view_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)


class GameEvent(Base):
    __tablename__ = "game_events"
    __table_args__ = (UniqueConstraint("run_id", "seq", name="uq_game_events_run_seq"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default="player")
    source_action_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)


class GameCheckpoint(Base):
    __tablename__ = "game_checkpoints"
    __table_args__ = (UniqueConstraint("run_id", "revision", name="uq_game_checkpoints_run_rev"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    state_json: Mapped[str] = mapped_column(Text, nullable=False)
    seed: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    parent_run_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    source_action_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)


class PerformanceJob(Base):
    __tablename__ = "performance_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    action_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    kind: Mapped[str] = mapped_column(String(40), nullable=False, default="performance")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
