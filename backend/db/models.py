import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db.session import Base


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="active")
    current_mode: Mapped[str] = mapped_column(String(20), default="global")
    active_character_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    task_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    plot_outline: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
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
        DateTime, default=datetime.utcnow, nullable=False
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
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
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
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    session: Mapped[Optional["Session"]] = relationship(back_populates="character_dossiers")
