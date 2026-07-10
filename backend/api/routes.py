from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import AsyncGenerator
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from db.session import get_db, async_session_factory
from db.models import Session as SessionModel, Message as MessageModel
from agents.provider import ProviderFacade
from agents.director import DirectorAgent
from models.schemas import (
    SessionCreate,
    SessionAction,
    SessionActionResponse,
    SessionResponse,
    AgentEvent,
)

# In-flight SSE queues for beat-by-beat flow
_session_queues: dict[str, dict] = {}

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dependencies – pull singletons created in lifespan (main.py)
# ---------------------------------------------------------------------------

def get_provider(request: Request) -> ProviderFacade:
    return request.app.state.provider


def get_director(request: Request) -> DirectorAgent:
    return request.app.state.director


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@router.get("/health")
async def api_health():
    return {"status": "ok", "service": "breaking-bad-roleplay"}


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

@router.post("/session/create", response_model=SessionResponse)
async def create_session(
    payload: SessionCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new roleplay session.

    Body: { title: str, task_prompt: str }
    - task_prompt is the player's natural-language mission, stored on the
      Session row and fed to the Director when streaming begins.
    """
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    new_session = SessionModel(
        id=session_id,
        title=payload.title,
        status="active",
        current_mode="story",
        task_prompt=payload.task_prompt,
        active_character_id=payload.active_character_id,
        created_at=now,
        updated_at=now,
    )
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)

    return SessionResponse(
        session_id=new_session.id,
        title=new_session.title,
        status=new_session.status,
        created_at=new_session.created_at,
    )


# ---------------------------------------------------------------------------
# Player actions (control flow, not chat)
# ---------------------------------------------------------------------------

@router.post("/session/{session_id}/action", response_model=SessionActionResponse)
async def session_action(
    session_id: str,
    payload: SessionAction,
    db: AsyncSession = Depends(get_db),
):
    """
    Handle player control actions.

    Supported actions:
      - continue         : no-op ack; frontend reconnects to /stream for next beat
      - stop             : pause the session (status -> "paused")
      - redirect         : replace task_prompt with a new direction
      - switch_perspective: change active_character_id
      - continue_chapter : append a fresh chapter to the running outline
      - branch           : regenerate outline from a chosen beat_id
      - replay           : re-render a specific beat in place
    """
    result = await db.execute(
        select(SessionModel).where(SessionModel.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    action = payload.action

    if action == "continue":
        # Resume the session in case a prior "stop" flipped status to
        # "paused". Without this, a fresh /stream request after stop would
        # terminate immediately on the stop-signal check in event_generator.
        session.status = "active"
        # Signal the Director to advance to the next beat.
        session_id_to_signal = session.id
        session_data = _session_queues.get(session_id_to_signal)
        if session_data and not session_data["queue"].full():
            session_data["queue"].put_nowait({"action": "continue"})

    elif action == "stop":
        session.status = "paused"

    elif action == "redirect":
        if not payload.redirect_prompt:
            raise HTTPException(
                status_code=400,
                detail="redirect_prompt is required for redirect action",
            )
        session.task_prompt = payload.redirect_prompt
        session_data = _session_queues.get(session.id)
        if session_data and not session_data["queue"].full():
            session_data["queue"].put_nowait(
                {"action": "redirect", "prompt": payload.redirect_prompt}
            )

    elif action == "switch_perspective":
        if not payload.target_character:
            raise HTTPException(
                status_code=400,
                detail="target_character is required for switch_perspective action",
            )
        session.active_character_id = payload.target_character
        session_data = _session_queues.get(session.id)
        if session_data and not session_data["queue"].full():
            session_data["queue"].put_nowait(
                {"action": "switch_perspective", "target": payload.target_character}
            )

    elif action == "continue_chapter":
        # Out-of-band: append a new chapter to the running outline. The
        # Director will generate fresh beats once it picks the signal off
        # its action_queue. Append a chapter-marker suffix so the UI can
        # tell chapter 2 from chapter 1 in the outline header.
        session.title = f"{session.title} (continued)" if session.title else "continued"
        session_data = _session_queues.get(session.id)
        if session_data and not session_data["queue"].full():
            session_data["queue"].put_nowait(
                {"action": "continue_chapter", "branch_goal": payload.branch_goal}
            )

    elif action == "branch":
        if not payload.from_beat_id:
            raise HTTPException(
                status_code=400,
                detail="from_beat_id is required for branch action",
            )
        session_data = _session_queues.get(session.id)
        if session_data and not session_data["queue"].full():
            session_data["queue"].put_nowait(
                {
                    "action": "branch",
                    "from_beat_id": payload.from_beat_id,
                    "branch_goal": payload.branch_goal or "",
                }
            )

    elif action == "replay":
        if not payload.beat_id:
            raise HTTPException(
                status_code=400,
                detail="beat_id is required for replay action",
            )
        session_data = _session_queues.get(session.id)
        if session_data and not session_data["queue"].full():
            session_data["queue"].put_nowait(
                {"action": "replay", "beat_id": payload.beat_id}
            )

    else:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown action: {action}. "
                "Expected continue|stop|redirect|switch_perspective|"
                "continue_chapter|branch|replay"
            ),
        )

    session.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()

    return SessionActionResponse(status="ok", session_id=session_id)


# ---------------------------------------------------------------------------
# SSE stream — Director-driven narrative beats
# ---------------------------------------------------------------------------

@router.get("/session/{session_id}/stream")
async def stream_session(
    session_id: str,
    voice_example: str | None = Query(default=None),
    language: str = Query(default="en"),
    director: DirectorAgent = Depends(get_director),
):
    """
    Stream narrative events from the Director agent as SSE.

    Loads the session's task_prompt and passes it to Director.process()
    along with ``session_factory`` and ``session_id`` so the Director can
    update dossiers using short-lived DB sessions.

    Cycle 45 (H1): this endpoint no longer takes a request-level DB
    session via ``Depends(get_db)``. A ``StreamingResponse`` generator
    only releases its dependency after the generator completes — so a
    request-level session would stay open for the entire SSE stream (up
    to 300s per beat), exhausting the connection pool under modest
    concurrency (pool_size=5 + max_overflow=10 = 15 streams). Instead we
    open a short-lived session from ``async_session_factory`` for the
    existence check, pass the factory to the Director (which opens its
    own short-lived sessions per beat), and re-open a session for each
    per-event stop-signal check. No DB connection is held during the
    inter-beat waits.
    """
    # Existence check + task_prompt fetch — short-lived session so the
    # connection returns to the pool before the SSE stream starts.
    async with async_session_factory() as db:
        result = await db.execute(
            select(SessionModel).where(SessionModel.id == session_id)
        )
        session = result.scalar_one_or_none()
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")

        if not session.task_prompt:
            raise HTTPException(
                status_code=400,
                detail="Session has no task_prompt — create the session with a task description.",
            )

        task = session.task_prompt
        resolved_session_id = session.id

    async def event_generator() -> AsyncGenerator[bytes, None]:
        # Set up beat-pause queue
        beat_queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        _session_queues[resolved_session_id] = {"queue": beat_queue, "beat_index": 0}

        try:
            async for event in director.process(
                task=task,
                session_factory=async_session_factory,
                session_id=resolved_session_id,
                action_queue=beat_queue,
                voice_example=voice_example,
                language=language,
            ):
                # Stop-signal check: POST /session/{id}/action with
                # action=stop flips session.status to "paused" in a
                # separate request. Re-read it here (column select, so
                # it bypasses the identity map and sees the committed
                # value) so the stream actually terminates instead of
                # continuing to burn LLM tokens after the user hit stop.
                # ``continue`` flips status back to "active", so this
                # check does not break the resume flow.
                #
                # Cycle 45 (H1): open a fresh short-lived session for
                # each check — never hold a connection across yields.
                async with async_session_factory() as chk_db:
                    status_result = await chk_db.execute(
                        select(SessionModel.status).where(
                            SessionModel.id == resolved_session_id
                        )
                    )
                    current_status = status_result.scalar_one_or_none()
                if current_status in ("paused", "stopped"):
                    stop_evt = AgentEvent(
                        type="status",
                        data={"message": "Stream stopped.", "stopped": True},
                    )
                    yield (
                        f"event: status\n"
                        f"data: {stop_evt.model_dump_json()}\n\n"
                    ).encode("utf-8")
                    break
                payload = (
                    f"event: {event.type}\n"
                    f"data: {event.model_dump_json()}\n\n"
                )
                yield payload.encode("utf-8")
        except asyncio.CancelledError:
            # Client disconnected — exit cleanly, no error event.
            return
        except Exception:
            # Sanitize: never leak raw exception (may contain API keys,
            # internal paths, DB connection strings) to the client.
            # Full traceback is preserved in server logs.
            logger.exception("SSE stream failed for session %s", resolved_session_id)
            err = AgentEvent(
                type="error",
                data={"message": "Internal server error during stream."},
            )
            yield (
                f"event: error\n"
                f"data: {err.model_dump_json()}\n\n"
            ).encode("utf-8")
        finally:
            # Always clean up the session queue to prevent memory leaks.
            # Covers: normal completion, client disconnect, and error paths.
            _session_queues.pop(resolved_session_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Message history — recover story beats after page refresh
# ---------------------------------------------------------------------------

class MessageOut(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    character_name: str | None = None
    emotion_state: str | None = None
    gif_search_query: str | None = None
    beat_id: str | None = None
    created_at: datetime


@router.get("/session/{session_id}/messages", response_model=list[MessageOut])
async def list_session_messages(
    session_id: str,
    limit: int = 500,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """
    Return persisted assistant messages for a session, ordered oldest-first.

    Used by the frontend to rebuild story history after a page refresh.
    Only agent_speak events are persisted by the Director, so this list
    represents the canonical dialogue history of the session.

    ``limit`` is capped at 500 to prevent unbounded memory/bandwidth
    consumption on long sessions. ``offset`` supports pagination for
    clients that need to walk full history in chunks.
    """
    if limit < 1:
        raise HTTPException(
            status_code=400, detail="limit must be >= 1"
        )
    if offset < 0:
        raise HTTPException(
            status_code=400, detail="offset must be >= 0"
        )
    # Cap limit at 500 regardless of what the client asks for.
    effective_limit = min(limit, 500)

    # H3: select only the primary-key column instead of the full row.
    # ``Session.messages`` / ``character_states`` / ``character_dossiers``
    # are configured lazy="selectin", so loading a full Session row would
    # trigger 3 extra SELECTs pulling in all messages/states/dossiers —
    # data we don't need just to verify the session exists.
    existence = await db.execute(
        select(SessionModel.id).where(SessionModel.id == session_id)
    )
    if existence.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Session not found")

    rows = await db.execute(
        select(MessageModel)
        .where(MessageModel.session_id == session_id)
        .order_by(MessageModel.created_at.asc(), MessageModel.id.asc())
        .limit(effective_limit)
        .offset(offset)
    )
    return rows.scalars().all()


# ---------------------------------------------------------------------------
# Chat endpoint — Python backend replacement for the old Node.js /api/chat
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    characterId: str
    userInput: str
    relation: str = "partner"
    mode: str = "direct"          # "direct" | "crew"
    history: list[dict] = []
    language: str = "en"
    llmProvider: str = "stepfun"  # "minimax" | "stepfun" — routed through ProviderFacade
    voiceExample: str | None = None


class ChatResponseDirect(BaseModel):
    reply_text: str
    emotion_state: str | None = None
    gif_search_query: str | None = None
    thinking: str | None = None
    tool_executed: str | None = None
    tool_log: str | None = None
    updated_relationship_state: dict | None = None


class ChatResponseCrew(BaseModel):
    participants: list[str]
    scene_goal: str | None = None
    tension_note: str | None = None
    debate_logs: list[dict] = []


@router.post("/chat")
async def chat(
    payload: ChatRequest,
    director: DirectorAgent = Depends(get_director),
):
    """
    Unified chat endpoint — handles both direct and crew modes.

    Request body:
      { characterId, userInput, relation, mode, history, language,
        llmProvider, voiceExample }

    Direct mode response:
      { reply_text, emotion_state, gif_search_query, thinking,
        tool_executed, tool_log, updated_relationship_state }

    Crew mode response:
      { participants, scene_goal, tension_note, debate_logs }
    """
    if not payload.userInput.strip():
        raise HTTPException(status_code=400, detail="userInput is required.")

    if payload.mode not in ("direct", "crew"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid mode '{payload.mode}'. Expected 'direct' or 'crew'.",
        )

    try:
        result = await director.handle_chat_message(
            character_id=payload.characterId,
            user_message=payload.userInput,
            context={
                "relation": payload.relation,
                "mode": payload.mode,
                "history": payload.history,
                "language": payload.language,
                "llmProvider": payload.llmProvider,
                "voiceExample": payload.voiceExample,
            },
            session_factory=async_session_factory,
        )
        return result
    except HTTPException:
        raise
    except Exception:
        # Sanitize: never leak raw exception detail to the client.
        # Full traceback is preserved in server logs.
        logger.exception("Chat endpoint failed for character %s", payload.characterId)
        raise HTTPException(
            status_code=500,
            detail="Internal server error.",
        )
