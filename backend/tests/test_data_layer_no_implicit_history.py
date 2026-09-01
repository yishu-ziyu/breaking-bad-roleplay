"""P4 (full-stack review) — no implicit full-history loads on Session rows.

Problem being fixed: ``Session.messages`` / ``character_states`` /
``character_dossiers`` are ``lazy="selectin"``, so EVERY full-row Session
load (11 call sites across routes.py + director.py, including the SSE
existence check, the FOR UPDATE beat claim, and the /messages existence
check whose comment claims an H3 fix it does not have) silently fires 3
extra SELECTs pulling the session's ENTIRE history. Nothing in production
code ever reads those relationship attributes, and nothing ORM-deletes a
Session (FK ondelete=CASCADE covers physical deletes) — so the selectin
behaviour is pure per-request overhead that grows with conversation length
and widens the SSE silence window (amplifying P1).

Fix contract under test:
1. The three relationships are configured raiseload ("raise"/"raise_on_sql")
   — an accidental attribute access becomes a loud error, not a hidden
   O(history) query.
2. Loading a full Session row emits exactly ONE statement (no selectins).
3. GET /messages emits exactly one sessions + one messages statement.
"""

from __future__ import annotations

import os

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://test:test@localhost:5432/test",
)
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ALLOWED_ORIGINS", "*")

import httpx
import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from db.models import (
    CharacterDossier,
    CharacterState,
    Message,
    Session as SessionModel,
)
from db.session import Base


@pytest.fixture
async def engine():
    eng = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
def sql_counter(engine):
    """Collect every SQL statement executed on the engine."""
    seen: list[str] = []

    def _before(conn, cursor, statement, parameters, context, executemany):
        seen.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _before)
    return seen


@pytest.fixture
async def factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


async def _seed(factory, messages: int = 8):
    async with factory() as db:
        db.add(
            SessionModel(
                id="sess-p4",
                title="t",
                task_prompt="cook",
                status="active",
            )
        )
        for i in range(messages):
            db.add(
                Message(
                    session_id="sess-p4",
                    role="walter",
                    content=f"line {i}",
                )
            )
        db.add(
            CharacterState(
                session_id="sess-p4", character_id="walter", current_emotion="calm"
            )
        )
        db.add(
            CharacterDossier(
                session_id="sess-p4", owner_id="walter", subject_id="jesse"
            )
        )
        await db.commit()


class TestRelationshipConfig:
    def test_history_relationships_are_raiseload(self):
        rels = SessionModel.__mapper__.relationships
        for name in ("messages", "character_states", "character_dossiers"):
            assert rels[name].lazy in ("raise", "raise_on_sql"), (
                f"{name} lazy={rels[name].lazy!r} — implicit full-history "
                "loads on every Session row select are the P4 regression"
            )


class TestNoImplicitSelectin:
    async def test_full_row_load_emits_single_statement(self, factory, sql_counter):
        await _seed(factory)
        sql_counter.clear()
        async with factory() as db:
            row = (
                await db.execute(
                    select(SessionModel).where(SessionModel.id == "sess-p4")
                )
            ).scalar_one()
            assert row.task_prompt == "cook"
        assert len(sql_counter) == 1, sql_counter
        joined = " ".join(sql_counter).lower()
        for table in ("messages", "character_states", "character_dossiers"):
            assert f"from {table}" not in joined

    async def test_attribute_access_raises_instead_of_hidden_query(
        self, factory, sql_counter
    ):
        await _seed(factory)
        async with factory() as db:
            row = (
                await db.execute(
                    select(SessionModel).where(SessionModel.id == "sess-p4")
                )
            ).scalar_one()
        sql_counter.clear()
        with pytest.raises(InvalidRequestError, match="lazy='raise'"):
            _ = row.messages
        assert sql_counter == []


class TestMessagesEndpointQueryBudget:
    async def test_messages_route_queries_each_table_once(self, factory, sql_counter):
        await _seed(factory, messages=40)
        from api.routes import get_db
        from main import app

        async def _override_db():
            async with factory() as db:
                yield db

        app.dependency_overrides[get_db] = _override_db
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                sql_counter.clear()
                resp = await client.get(
                    "/api/session/sess-p4/messages", params={"limit": 500}
                )
        finally:
            app.dependency_overrides.clear()

        assert resp.status_code == 200
        assert len(resp.json()) == 40
        messages_hits = [
            s for s in sql_counter if "from messages" in " ".join(s.split()).lower()
        ]
        sessions_hits = [
            s for s in sql_counter if "from sessions" in " ".join(s.split()).lower()
        ]
        assert len(sessions_hits) == 1, (
            f"/messages must probe sessions exactly once, got: {sessions_hits}"
        )
        assert len(messages_hits) == 1, (
            f"/messages must read the messages table exactly once, "
            f"got: {messages_hits}"
        )
