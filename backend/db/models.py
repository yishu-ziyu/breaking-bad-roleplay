import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db.session import Base


def _utcnow() -> datetime:
    """Naive UTC datetime — replacement for deprecated datetime.utcnow()."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="active")
    current_mode: Mapped[str] = mapped_column(String(20), default="story", nullable=False)
    active_character_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    task_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    plot_outline: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    next_beat_index: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False, server_default="0"
    )
    owner_token_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=_utcnow,
        onupdate=_utcnow,
        nullable=False,
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="selectin"
    )
    character_states: Mapped[list["CharacterState"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="selectin"
    )
    character_dossiers: Mapped[list["CharacterDossier"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="selectin"
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sessions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    character_name: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    emotion_state: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    gif_search_query: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    beat_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, nullable=False
    )

    session: Mapped["Session"] = relationship(back_populates="messages")


class CharacterState(Base):
    __tablename__ = "character_states"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    session_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("sessions.id", ondelete="CASCADE"), index=True, nullable=True
    )
    character_id: Mapped[str] = mapped_column(String(50), nullable=False)
    current_emotion: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=_utcnow,
        onupdate=_utcnow,
        nullable=False,
    )

    session: Mapped[Optional["Session"]] = relationship(back_populates="character_states")


class CharacterDossier(Base):
    __tablename__ = "character_dossiers"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    session_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("sessions.id", ondelete="CASCADE"), index=True, nullable=True
    )
    owner_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    subject_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    trust_level: Mapped[int] = mapped_column(default=5)
    knowledge: Mapped[str] = mapped_column(Text, default="{}")
    relationship_notes: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=_utcnow,
        onupdate=_utcnow,
        nullable=False,
    )

    session: Mapped[Optional["Session"]] = relationship(back_populates="character_dossiers")


# ---------------------------------------------------------------------------
# P3 (full-stack review): durable backing for BYOK bindings + daily quota.
# ---------------------------------------------------------------------------


class ByokConnection(Base):
    """Audit row for a BYOK bind — METADATA ONLY.

    The user's API key never touches the database; it lives in the
    process-RAM connection store (short TTL) and, client-side, in the
    encrypted vault. This row exists so ops can see which provider/model a
    connection id pointed at, and so a lost RAM session surfaces as an
    honest ``binding_expired`` (client rebinds from its vault) instead of a
    silent fallback to platform keys.
    """

    __tablename__ = "byok_connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    provider_id: Mapped[str] = mapped_column(String(40), nullable=False)
    model_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    base_url: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    region: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    key_hint: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    has_llm_key: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    has_tts_key: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_epoch: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_epoch: Mapped[int] = mapped_column(Integer, nullable=False)


class QuotaUsage(Base):
    """Per-identity per-day consumed credits (P3 durable quota tier)."""

    __tablename__ = "quota_usage"

    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    identity: Mapped[str] = mapped_column(String(191), primary_key=True)
    used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class QuotaUsageGlobal(Base):
    """Site-wide per-day consumed credits (P3 durable quota tier)."""

    __tablename__ = "quota_usage_global"

    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
