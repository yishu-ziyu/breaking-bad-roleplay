from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import AsyncGenerator
import asyncio
import uuid
from datetime import datetime

from db.session import get_db
from db.models import Session as SessionModel
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
    now = datetime.utcnow()

    new_session = SessionModel(
        id=session_id,
        title=payload.title,
        status="active",
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
      - continue  : no-op ack; frontend reconnects to /stream for next beat
      - stop       : pause the session (status -> "paused")
      - redirect   : replace task_prompt with a new direction
      - switch_perspective : change active_character_id
    """
    result = await db.execute(
        select(SessionModel).where(SessionModel.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    action = payload.action

    if action == "continue":
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

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown action: {action}. Expected continue|stop|redirect|switch_perspective",
        )

    session.updated_at = datetime.utcnow()
    await db.commit()

    return SessionActionResponse(status="ok", session_id=session_id)


# ---------------------------------------------------------------------------
# SSE stream — Director-driven narrative beats
# ---------------------------------------------------------------------------

@router.get("/session/{session_id}/stream")
async def stream_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    director: DirectorAgent = Depends(get_director),
):
    """
    Stream narrative events from the Director agent as SSE.

    Loads the session's task_prompt and passes it to Director.process()
    along with db and session_id so the Director can update dossiers.
    """
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

    async def event_generator() -> AsyncGenerator[bytes, None]:
        # Set up beat-pause queue
        beat_queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        _session_queues[session.id] = {"queue": beat_queue, "beat_index": 0}

        try:
            async for event in director.process(
                task=task,
                db=db,
                session_id=session.id,
                action_queue=beat_queue,
            ):
                payload = (
                    f"event: {event.type}\n"
                    f"data: {event.model_dump_json()}\n\n"
                )
                yield payload.encode("utf-8")
        except asyncio.CancelledError:
            # Client disconnected — exit cleanly, no error event.
            _session_queues.pop(session.id, None)
            return
        except Exception as exc:
            err = AgentEvent(type="error", data={"message": str(exc)})
            yield (
                f"event: error\n"
                f"data: {err.model_dump_json()}\n\n"
            ).encode("utf-8")

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
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=exc if isinstance(exc, str) else str(exc),
        )
