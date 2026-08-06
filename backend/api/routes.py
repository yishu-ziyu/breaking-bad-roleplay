from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import AsyncGenerator
import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone

from db.session import get_db, async_session_factory
from db.models import (
    Session as SessionModel,
    Message as MessageModel,
    CharacterDossier,
)
from agents.provider import ProviderFacade, MINIMAX_HOST_CN, MINIMAX_HOST_GLOBAL
from agents.byok_presets import PROVIDER_PRESETS, preset_by_id, known_provider_ids
from agents.director import DirectorAgent
from agents.tts import TTSError, synthesize_character_speech
from agents.voice_casting import CLONE_VOICE_IDS
from agents.credential_context import use_credentials, CredentialOverride
from agents.connection_sessions import connection_store, session_public_view
from agents.quota import (
    enforce_platform_quota,
    read_quota_snapshot,
    normalize_guest_id,
)
from config import settings
from models.schemas import (
    SessionCreate,
    SessionAction,
    SessionActionResponse,
    SessionResponse,
    AgentEvent,
)
import time
import httpx

router = APIRouter()
logger = logging.getLogger(__name__)


def _guest_id_from_request(request: Request, explicit: str | None = None) -> str | None:
    raw = explicit or request.headers.get("x-guest-id") or request.headers.get("X-Guest-Id")
    return normalize_guest_id(raw)


def _quota_http_exception(decision) -> HTTPException:
    """Map quota denial to HTTP without leaking secrets or internals."""
    snap = decision.snapshot
    detail = {
        "code": decision.reason or "quota_denied",
        "message": {
            "free_quota_exhausted": "Free demo credits used up for today. Connect your own key to continue.",
            "global_budget_exhausted": "Platform demo is at capacity today. Try again tomorrow or use your own key.",
            "rate_limited": "Too many requests from this network. Slow down or use your own key.",
        }.get(decision.reason or "", "Platform free tier unavailable."),
        "remaining": snap.remaining,
        "limit": snap.limit,
        "globalRemaining": snap.global_remaining,
        "day": snap.day,
        "byok": snap.byok,
    }
    return HTTPException(status_code=decision.http_status, detail=detail)


async def _require_platform_quota(
    request: Request,
    *,
    action: str,
    mode: str | None = None,
    connection_session_id: str | None = None,
    guest_id: str | None = None,
    access_token: str | None = None,
):
    decision = await enforce_platform_quota(
        request=request,
        action=action,
        mode=mode,
        connection_session_id=connection_session_id,
        guest_id=guest_id or _guest_id_from_request(request),
        access_token=access_token,
    )
    if not decision.allowed:
        raise _quota_http_exception(decision)
    return decision.snapshot


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
# BYOK connections (catalog / test / bind)
# ---------------------------------------------------------------------------

PROVIDER_CATALOG = PROVIDER_PRESETS


def _platform_flags() -> dict[str, bool]:
    # Platform demo keys only (MiniMax / StepFun). BYOK presets are always choosable.
    return {
        "minimax": bool(settings.minimax_api_key),
        "stepfun": bool(settings.stepfun_api_key),
    }


def _resolve_override_from_session(connection_session_id: str | None) -> CredentialOverride | None:
    if not connection_session_id:
        return None
    session = connection_store.get(connection_session_id)
    if session is None:
        return None
    return session.override


@router.get("/connections/catalog")
async def connections_catalog():
    """Public provider brand catalog + which platform keys are available."""
    platform = _platform_flags()
    default_provider = (
        "stepfun" if platform.get("stepfun")
        else "minimax" if platform.get("minimax")
        else "stepfun"
    )
    default_model = next(
        (p["defaultModel"] for p in PROVIDER_CATALOG if p["id"] == default_provider),
        "step-3.7-flash",
    )
    return {
        "providers": PROVIDER_CATALOG,
        "platform": platform,
        "defaults": {
            "providerId": default_provider,
            "modelId": default_model,
        },
    }


class ConnectionTestRequest(BaseModel):
    providerId: str
    purpose: str = "llm"  # llm | tts
    apiKey: str | None = None
    baseUrl: str | None = None
    region: str | None = "cn"
    modelId: str | None = None


@router.post("/connections/test")
async def connections_test(payload: ConnectionTestRequest):
    """Probe a provider with a user-supplied key. Does not persist the key."""
    provider = payload.providerId.strip().lower()
    purpose = (payload.purpose or "llm").strip().lower()
    if provider not in known_provider_ids() and provider != "cliproxy":
        raise HTTPException(status_code=400, detail="Unknown providerId")
    if purpose not in ("llm", "tts"):
        raise HTTPException(status_code=400, detail="purpose must be llm or tts")

    started = time.perf_counter()
    try:
        if provider == "minimax" and purpose == "tts":
            if not payload.apiKey:
                raise HTTPException(status_code=400, detail="apiKey required for MiniMax TTS")
            host = MINIMAX_HOST_GLOBAL if payload.region == "global" else MINIMAX_HOST_CN
            async with httpx.AsyncClient(timeout=15.0, trust_env=False) as client:
                # Lightweight auth probe: empty-ish request still returns structured error with auth
                resp = await client.post(
                    f"{host}/v1/t2a_v2",
                    headers={
                        "Authorization": f"Bearer {payload.apiKey.strip()}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "speech-2.8-hd",
                        "text": "ok",
                        "stream": False,
                        "voice_setting": {"voice_id": "English_expressive_narrator", "speed": 1, "vol": 1, "pitch": 0},
                        "audio_setting": {"format": "mp3", "sample_rate": 32000},
                    },
                )
            latency = int((time.perf_counter() - started) * 1000)
            if resp.status_code in (401, 403):
                return {"ok": False, "status": "invalid", "latencyMs": latency, "message": "Invalid speech key"}
            if resp.status_code == 402:
                return {"ok": False, "status": "quota", "latencyMs": latency, "message": "Quota exceeded"}
            # 200 or business error with auth accepted
            return {"ok": True, "status": "valid", "latencyMs": latency, "message": "Speech key accepted"}

        if provider == "minimax":
            if not payload.apiKey:
                raise HTTPException(status_code=400, detail="apiKey required")
            host = MINIMAX_HOST_GLOBAL if payload.region == "global" else MINIMAX_HOST_CN
            model = payload.modelId or "MiniMax-M3"
            async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
                resp = await client.post(
                    f"{host}/anthropic/v1/messages",
                    headers={
                        "Content-Type": "application/json",
                        "anthropic-version": "2023-06-01",
                        "x-api-key": payload.apiKey.strip(),
                    },
                    json={
                        "model": model,
                        "max_tokens": 8,
                        "messages": [{"role": "user", "content": "ping"}],
                    },
                )
            latency = int((time.perf_counter() - started) * 1000)
            if resp.status_code in (401, 403):
                return {"ok": False, "status": "invalid", "latencyMs": latency, "message": "Invalid MiniMax key"}
            if resp.status_code == 402:
                return {"ok": False, "status": "quota", "latencyMs": latency, "message": "Quota exceeded"}
            if resp.status_code >= 400:
                return {
                    "ok": False,
                    "status": "unreachable",
                    "latencyMs": latency,
                    "message": f"MiniMax HTTP {resp.status_code}",
                }
            return {"ok": True, "status": "valid", "latencyMs": latency, "message": "Connected"}

        if provider == "stepfun":
            if not payload.apiKey:
                raise HTTPException(status_code=400, detail="apiKey required")
            model = payload.modelId or "step-3.7-flash"
            async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
                resp = await client.post(
                    "https://api.stepfun.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {payload.apiKey.strip()}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 8,
                    },
                )
            latency = int((time.perf_counter() - started) * 1000)
            if resp.status_code in (401, 403):
                return {"ok": False, "status": "invalid", "latencyMs": latency, "message": "Invalid StepFun key"}
            if resp.status_code == 402:
                return {"ok": False, "status": "quota", "latencyMs": latency, "message": "Quota exceeded"}
            if resp.status_code >= 400:
                return {
                    "ok": False,
                    "status": "unreachable",
                    "latencyMs": latency,
                    "message": f"StepFun HTTP {resp.status_code}",
                }
            return {"ok": True, "status": "valid", "latencyMs": latency, "message": "Connected"}

        # Generic BYOK presets (OpenAI / Anthropic compatible).
        preset = preset_by_id(provider)
        if preset is not None:
            if purpose == "tts":
                return {
                    "ok": False,
                    "status": "invalid",
                    "latencyMs": 0,
                    "message": "TTS only supported for MiniMax",
                }
            if not payload.apiKey:
                raise HTTPException(status_code=400, detail="apiKey required")
            model = payload.modelId or preset.get("defaultModel") or "gpt-4o-mini"
            base = (payload.baseUrl or preset.get("defaultBaseUrl") or "").rstrip("/")
            if not base:
                raise HTTPException(status_code=400, detail="baseUrl required for this provider")
            kind = preset.get("kind") or "openai"
            async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
                if kind == "anthropic":
                    url = f"{base}/messages"
                    resp = await client.post(
                        url,
                        headers={
                            "Content-Type": "application/json",
                            "anthropic-version": "2023-06-01",
                            "x-api-key": payload.apiKey.strip(),
                        },
                        json={
                            "model": model,
                            "max_tokens": 8,
                            "messages": [{"role": "user", "content": "ping"}],
                        },
                    )
                else:
                    url = f"{base}/chat/completions"
                    resp = await client.post(
                        url,
                        headers={
                            "Authorization": f"Bearer {payload.apiKey.strip()}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": model,
                            "messages": [{"role": "user", "content": "ping"}],
                            "max_tokens": 8,
                        },
                    )
            latency = int((time.perf_counter() - started) * 1000)
            label = preset.get("displayName") or provider
            if resp.status_code in (401, 403):
                return {
                    "ok": False,
                    "status": "invalid",
                    "latencyMs": latency,
                    "message": f"Invalid {label} key",
                }
            if resp.status_code == 402:
                return {
                    "ok": False,
                    "status": "quota",
                    "latencyMs": latency,
                    "message": "Quota exceeded",
                }
            if resp.status_code >= 400:
                return {
                    "ok": False,
                    "status": "unreachable",
                    "latencyMs": latency,
                    "message": f"{label} HTTP {resp.status_code}",
                }
            return {"ok": True, "status": "valid", "latencyMs": latency, "message": "Connected"}

        # Local-only cliproxy probe (not in public catalog).
        if provider == "cliproxy":
            base = (payload.baseUrl or settings.cli_proxy_base_url).rstrip("/")
            async with httpx.AsyncClient(timeout=8.0, trust_env=False) as client:
                try:
                    resp = await client.get(f"{base}/v1/models")
                except httpx.HTTPError:
                    latency = int((time.perf_counter() - started) * 1000)
                    return {
                        "ok": False,
                        "status": "unreachable",
                        "latencyMs": latency,
                        "message": f"Cannot reach {base}",
                    }
            latency = int((time.perf_counter() - started) * 1000)
            if resp.status_code >= 500:
                return {
                    "ok": False,
                    "status": "unreachable",
                    "latencyMs": latency,
                    "message": "CLIProxy error",
                }
            return {
                "ok": True,
                "status": "valid",
                "latencyMs": latency,
                "message": f"Reachable {base}",
            }

        raise HTTPException(status_code=400, detail="Unknown providerId")

    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        latency = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "status": "unreachable",
            "latencyMs": latency,
            "message": "Network error",
        }
    except Exception:
        logger.exception("connections_test failed")
        latency = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "status": "unreachable",
            "latencyMs": latency,
            "message": "Test failed",
        }


class ConnectionBindRequest(BaseModel):
    providerId: str
    modelId: str | None = None
    llmKey: str | None = None
    ttsKey: str | None = None
    baseUrl: str | None = None
    region: str | None = "cn"


@router.post("/connections/bind")
async def connections_bind(payload: ConnectionBindRequest):
    """Create a short-lived RAM bind session for SSE/chat/tts."""
    provider = payload.providerId.strip().lower()
    if provider not in known_provider_ids() and provider != "cliproxy":
        raise HTTPException(status_code=400, detail="Unknown providerId")
    preset = preset_by_id(provider)
    needs_key = True if preset is None else bool(preset.get("needsLlmKey", True))
    if needs_key and not (payload.llmKey and payload.llmKey.strip()):
        raise HTTPException(status_code=400, detail="llmKey required for this provider")
    # Prefer explicit baseUrl; else preset default (custom still needs user base).
    base_url = payload.baseUrl
    if not base_url and preset and preset.get("defaultBaseUrl"):
        base_url = preset["defaultBaseUrl"]
    if preset and preset.get("needsBaseUrl") and not (base_url and str(base_url).strip()):
        raise HTTPException(status_code=400, detail="baseUrl required for custom provider")
    model_id = payload.modelId or (preset.get("defaultModel") if preset else None)
    session = connection_store.bind(
        provider_id=provider,
        model_id=model_id,
        llm_key=payload.llmKey,
        tts_key=payload.ttsKey,
        base_url=base_url,
        region=payload.region,
    )
    return session_public_view(session)


@router.get("/connections/bind/{session_id}")
async def connections_bind_get(session_id: str):
    """Probe whether a RAM bind session is still alive (sliding TTL on hit)."""
    session = connection_store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Connection session not found or expired")
    return session_public_view(session)


@router.delete("/connections/bind/{session_id}")
async def connections_unbind(session_id: str):
    ok = connection_store.revoke(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Connection session not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Platform free-tier quota (server-enforced; keys never exposed)
# ---------------------------------------------------------------------------

@router.get("/quota")
async def get_quota(
    request: Request,
    guest_id: str | None = Query(default=None),
    connection_session: str | None = Query(default=None),
    access_token: str | None = Query(default=None),
):
    """Return remaining free credits (guest 8 / logged-in 80 / BYOK unlimited)."""
    gid = _guest_id_from_request(request, guest_id)
    snap = await read_quota_snapshot(
        request=request,
        guest_id=gid,
        connection_session_id=connection_session,
        access_token=access_token,
    )
    return {
        "day": snap.day,
        "used": snap.used,
        "limit": snap.limit,
        "remaining": snap.remaining,
        "globalUsed": snap.global_used,
        "globalLimit": snap.global_limit,
        "globalRemaining": snap.global_remaining,
        "byok": snap.byok,
        "tier": snap.tier,
        "costs": {
            "chatDirect": 1,
            "chatCrew": 2,
            "storyBeat": 5,
            "tts": 1,
        },
    }


# ---------------------------------------------------------------------------
# TTS (cloned character voices via MiniMax T2A)
# ---------------------------------------------------------------------------

class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    characterId: str
    language: str = "en"
    connectionSessionId: str | None = None


@router.get("/tts/voices")
async def list_tts_voices():
    """Return which characters currently have cloned MiniMax voices."""
    return {
        "provider": "minimax",
        "characters": sorted(CLONE_VOICE_IDS.keys()),
        "voice_ids": CLONE_VOICE_IDS,
    }


@router.post("/tts")
async def synthesize_tts(
    request: Request,
    payload: TtsRequest,
    provider: ProviderFacade = Depends(get_provider),
):
    """Synthesize speech for a cloned character voice. Returns audio/mpeg."""
    snap = await _require_platform_quota(
        request,
        action="tts",
        connection_session_id=payload.connectionSessionId,
    )
    override = _resolve_override_from_session(payload.connectionSessionId)
    # Platform key stays server-side only. BYOK uses bind override keys.
    api_key = settings.minimax_api_key
    if override is not None:
        api_key = override.tts_key or override.llm_key or api_key
    elif hasattr(provider, "effective_minimax_tts_key"):
        with use_credentials(override):
            api_key = provider.effective_minimax_tts_key() or api_key

    if not api_key:
        raise HTTPException(status_code=503, detail="Speech is not configured on this server.")

    try:
        with use_credentials(override):
            audio, mime = await synthesize_character_speech(
                text=payload.text,
                character_id=payload.characterId,
                language=payload.language,
                api_key=api_key,
            )
    except TTSError as exc:
        # Never echo raw provider bodies (may include account hints).
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception:
        logger.exception("TTS endpoint failed for character %s", payload.characterId)
        raise HTTPException(status_code=500, detail="TTS internal error.") from None

    return Response(
        content=audio,
        media_type=mime,
        headers={
            "Cache-Control": "no-store",
            "X-Voice-Character": payload.characterId,
            "X-Quota-Remaining": str(snap.remaining if not snap.byok else "byok"),
        },
    )


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
        next_beat_index=0,
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

    elif action == "stop":
        session.status = "paused"

    elif action == "redirect":
        if not payload.redirect_prompt:
            raise HTTPException(
                status_code=400,
                detail="redirect_prompt is required for redirect action",
            )
        session.task_prompt = payload.redirect_prompt
        session.plot_outline = None
        session.next_beat_index = 0
        session.status = "active"

    elif action == "switch_perspective":
        if not payload.target_character:
            raise HTTPException(
                status_code=400,
                detail="target_character is required for switch_perspective action",
            )
        # Persist canonical frontend short id when possible (walter/jesse/…).
        from agents.director import (
            BACKEND_TO_FRONTEND_ID,
            FRONTEND_TO_BACKEND_ID,
            resolve_backend_character_id,
        )

        raw_target = payload.target_character.strip()
        backend_name = resolve_backend_character_id(raw_target)
        if backend_name and backend_name in BACKEND_TO_FRONTEND_ID:
            session.active_character_id = BACKEND_TO_FRONTEND_ID[backend_name]
        elif raw_target.lower() in FRONTEND_TO_BACKEND_ID:
            session.active_character_id = raw_target.lower()
        else:
            session.active_character_id = raw_target
        session.status = "active"

    elif action == "continue_chapter":
        # Start a fresh persisted outline while retaining the prior messages
        # as the completed chapter history.
        session.title = f"{session.title} (continued)" if session.title else "continued"
        if payload.branch_goal:
            session.task_prompt = f"{session.task_prompt}\nNext chapter: {payload.branch_goal}"
        session.plot_outline = None
        session.next_beat_index = 0
        session.status = "active"

    elif action == "branch":
        if not payload.from_beat_id:
            raise HTTPException(
                status_code=400,
                detail="from_beat_id is required for branch action",
            )
        branch_goal = payload.branch_goal or "Continue with a different consequence."
        session.task_prompt = (
            f"{session.task_prompt}\nBranch after {payload.from_beat_id}: {branch_goal}"
        )
        session.plot_outline = None
        session.next_beat_index = 0
        session.status = "active"

    elif action == "replay":
        if not payload.beat_id:
            raise HTTPException(
                status_code=400,
                detail="beat_id is required for replay action",
            )
        match = re.fullmatch(r"beat[_-](\d+)", payload.beat_id)
        if match is None:
            raise HTTPException(
                status_code=400,
                detail="beat_id must use the form beat_1 or beat-1",
            )
        session.next_beat_index = max(0, int(match.group(1)) - 1)
        session.status = "active"

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
    request: Request,
    session_id: str,
    voice_example: str | None = Query(default=None),
    language: str = Query(default="en"),
    connection_session: str | None = Query(default=None),
    guest_id: str | None = Query(default=None),
    access_token: str | None = Query(default=None),
    zh_guard: str | None = Query(default=None),
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

    Platform free-tier: one story beat costs 5 credits (charged after session
    validation, before LLM work). BYOK connection_session skips the meter.
    EventSource cannot set Authorization headers; pass access_token query
    for logged-in early-access tier (80 credits/day).
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

        resolved_session_id = session.id

    # Charge only after the session is known valid (do not bill 404s).
    # SSE cannot set custom headers; guest_id / access_token go in the query.
    await _require_platform_quota(
        request,
        action="story_beat",
        connection_session_id=connection_session,
        guest_id=_guest_id_from_request(request, guest_id),
        access_token=access_token,
    )

    bind_override = _resolve_override_from_session(connection_session)

    def _bind_model_route() -> str | None:
        if bind_override is None or not bind_override.provider_id:
            return None
        pid = bind_override.provider_id
        preset = preset_by_id(pid)
        fallback = (
            (preset.get("defaultModel") if preset else None)
            or {
                "minimax": "MiniMax-M3",
                "stepfun": "step-3.7-flash",
                "cliproxy": getattr(director.provider, "cli_proxy_default_model", "gemini-pro-agent"),
            }.get(pid, "step-3.7-flash")
        )
        model = bind_override.model_id or fallback
        return f"{pid}/{model}"

    async def event_generator() -> AsyncGenerator[bytes, None]:
        prev_route = director.model_route
        bound_route = _bind_model_route()
        if bound_route:
            director.model_route = bound_route
        try:
            with use_credentials(bind_override):
                async for event in director.process_next_beat(
                    session_factory=async_session_factory,
                    session_id=resolved_session_id,
                    voice_example=voice_example,
                    language=language,
                    zh_guard=zh_guard != "0",
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
            director.model_route = prev_route
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

class PlotGraphResponse(BaseModel):
    session_id: str
    title: str
    task_prompt: str = ""
    era: str = ""
    summary: dict = {}
    nodes: list[dict] = []
    edges: list[dict] = []
    mermaid: str = ""


@router.get("/session/{session_id}/plot-graph", response_model=PlotGraphResponse)
async def get_session_plot_graph(
    session_id: str,
    language: str = Query(default="en"),
    db: AsyncSession = Depends(get_db),
):
    """Return this session's personal plot graph (story net).

    Built from outline spine + spoken co-presence + Continuity Board
    facts/tensions/costs. Unique to what the player actually played.
    """
    from agents.plot_graph import build_plot_graph
    from agents.continuity_board import (
        BOARD_OWNER_ID,
        BOARD_SUBJECT_ID,
        board_from_json as parse_board,
    )

    sess_result = await db.execute(
        select(SessionModel).where(SessionModel.id == session_id)
    )
    session = sess_result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    msg_result = await db.execute(
        select(MessageModel)
        .where(MessageModel.session_id == session_id)
        .order_by(MessageModel.created_at.asc())
        .limit(500)
    )
    messages = list(msg_result.scalars().all())

    board = None
    try:
        dres = await db.execute(
            select(CharacterDossier).where(
                CharacterDossier.session_id == session_id,
                CharacterDossier.owner_id == BOARD_OWNER_ID,
                CharacterDossier.subject_id == BOARD_SUBJECT_ID,
            )
        )
        drow = dres.scalar_one_or_none()
        if drow is not None:
            board = parse_board(drow.knowledge)
    except Exception:
        board = None

    graph = build_plot_graph(
        session_id=session_id,
        title=session.title,
        task_prompt=session.task_prompt,
        outline=session.plot_outline,
        messages=messages,
        board=board,
        language=language,
    )
    return PlotGraphResponse(**graph)


# Chat endpoint — Python backend replacement for the old Node.js /api/chat
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    characterId: str
    userInput: str
    relation: str = "partner"
    mode: str = "direct"          # "direct" | "crew"
    history: list[dict] = []
    language: str = "en"
    llmProvider: str = "stepfun"  # catalog provider id (minimax/stepfun/deepseek/...)
    modelId: str | None = None
    voiceExample: str | None = None
    connectionSessionId: str | None = None
    # Optional experiment path: Agent Harness pipeline instead of director.
    # Default False keeps production chat unchanged.
    useHarness: bool = False


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


def _map_harness_to_chat_direct(harness_out: dict) -> dict:
    """Map AgentHarnessService.run() dict → ChatResponseDirect-shaped dict."""
    steps = harness_out.get("steps") or []
    if not isinstance(steps, list):
        steps = []

    emotion_state = "tense"
    for step in steps:
        if not isinstance(step, dict):
            continue
        if step.get("tool_name") == "set_emotion":
            args = step.get("args") or {}
            if isinstance(args, dict):
                em = args.get("emotion")
                if isinstance(em, str) and em.strip():
                    emotion_state = em.strip()
                    break

    tool_executed: str | None = None
    tool_log: str | None = None
    for step in steps:
        if not isinstance(step, dict):
            continue
        name = step.get("tool_name")
        if isinstance(name, str) and name:
            tool_executed = name
            content = step.get("content")
            tool_log = str(content)[:800] if content is not None else None
            break

    status_bar = harness_out.get("status_bar")
    memory_preview = harness_out.get("memory_preview")
    thinking: str | None = None
    if isinstance(status_bar, str) and status_bar.strip():
        thinking = status_bar.strip()
    elif isinstance(memory_preview, str) and memory_preview.strip():
        thinking = memory_preview.strip()[:400]

    reply = harness_out.get("reply")
    reply_text = reply if isinstance(reply, str) else str(reply or "")

    return {
        "reply_text": reply_text,
        "emotion_state": emotion_state,
        "gif_search_query": None,
        "thinking": thinking,
        "tool_executed": tool_executed,
        "tool_log": tool_log,
        "updated_relationship_state": None,
    }


@router.post("/chat")
async def chat(
    request: Request,
    payload: ChatRequest,
    director: DirectorAgent = Depends(get_director),
):
    """
    Unified chat endpoint — handles both direct and crew modes.

    Request body:
      { characterId, userInput, relation, mode, history, language,
        llmProvider, voiceExample, useHarness? }

    Direct mode response:
      { reply_text, emotion_state, gif_search_query, thinking,
        tool_executed, tool_log, updated_relationship_state }

    Crew mode response:
      { participants, scene_goal, tension_note, debate_logs }

    When useHarness=true, always returns ChatResponseDirect shape via
    Agent Harness (same chat quota; production default remains false).
    """
    if not payload.userInput.strip():
        raise HTTPException(status_code=400, detail="userInput is required.")

    if payload.mode not in ("direct", "crew"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid mode '{payload.mode}'. Expected 'direct' or 'crew'.",
        )

    snap = await _require_platform_quota(
        request,
        action="chat",
        mode=payload.mode,
        connection_session_id=payload.connectionSessionId,
    )

    # Optional harness path: same quota, no director rewrite.
    if payload.useHarness:
        try:
            from agents.harness.service import get_harness_service
        except Exception:
            logger.exception("harness service import failed (chat useHarness)")
            raise HTTPException(status_code=503, detail="Agent harness unavailable.")

        # Harness on /api/chat prefers offline tools+memory path for reliability.
        # Live LLM is attempted only when platform keys exist; hard model failures
        # fall back to offline so the try surface never returns a raw provider 400.
        live = _live_provider_available(request)
        provider = getattr(request.app.state, "provider", None) if live else None
        mode = payload.mode if payload.mode in ("direct", "crew") else "direct"

        try:
            harness_out = await get_harness_service().run(
                payload.userInput.strip(),
                character_id=payload.characterId or "walter",
                mode=mode,
                language=payload.language or "en",
                model_route=payload.modelId,
                session_id=payload.connectionSessionId,
                use_multi_agent=mode == "crew",
                provider=provider,
                offline=not live,
            )
            reply_text = str(harness_out.get("reply") or "")
            if live and (
                reply_text.startswith("Model call failed")
                or harness_out.get("meta", {}).get("stopped_reason") == "error"
            ):
                harness_out = await get_harness_service().run(
                    payload.userInput.strip(),
                    character_id=payload.characterId or "walter",
                    mode=mode,
                    language=payload.language or "en",
                    model_route=None,
                    session_id=payload.connectionSessionId,
                    use_multi_agent=mode == "crew",
                    provider=None,
                    offline=True,
                )
            result = _map_harness_to_chat_direct(harness_out)
            if not snap.byok:
                result = {**result, "quotaRemaining": snap.remaining}
            return result
        except HTTPException:
            raise
        except Exception:
            logger.exception(
                "Chat harness path failed for character %s", payload.characterId
            )
            raise HTTPException(
                status_code=500,
                detail="Internal server error.",
            )

    bind_override = _resolve_override_from_session(payload.connectionSessionId)
    # Prefer provider from bind when present
    llm_provider = payload.llmProvider
    if bind_override is not None and bind_override.provider_id:
        llm_provider = bind_override.provider_id

    try:
        with use_credentials(bind_override):
            result = await director.handle_chat_message(
                character_id=payload.characterId,
                user_message=payload.userInput,
                context={
                    "relation": payload.relation,
                    "mode": payload.mode,
                    "history": payload.history,
                    "language": payload.language,
                    "llmProvider": llm_provider,
                    "modelId": (
                        (bind_override.model_id if bind_override and bind_override.model_id else None)
                        or payload.modelId
                    ),
                    "voiceExample": payload.voiceExample,
                },
                session_factory=async_session_factory,
            )
        if isinstance(result, dict) and not snap.byok:
            result = {**result, "quotaRemaining": snap.remaining}
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


# ---------------------------------------------------------------------------
# Agent Harness surface (ai-agent-book → ABQ)
# Guest offline mode always allowed; live provider only when keys + offline=false.
# ---------------------------------------------------------------------------

class AgentRunRequest(BaseModel):
    message: str
    character_id: str = "walter"
    mode: str = "direct"  # direct|crew|story
    language: str = "zh"
    model_route: str | None = None
    use_multi_agent: bool = False
    session_id: str | None = None
    offline: bool = True


def _live_provider_available(request: Request) -> bool:
    """True when app has a provider and at least one platform key is configured."""
    provider = getattr(request.app.state, "provider", None)
    if provider is None:
        return False
    try:
        from config import settings as _settings
        return bool(
            getattr(_settings, "minimax_api_key", None)
            or getattr(_settings, "stepfun_api_key", None)
            or getattr(_settings, "cli_proxy_api_key", None)
        )
    except Exception:  # noqa: BLE001
        return False


@router.get("/agent/capabilities")
async def agent_capabilities():
    """Capability map + harness module import status (no auth)."""
    try:
        from agents.harness.service import capabilities_payload
        return capabilities_payload()
    except Exception as exc:  # noqa: BLE001
        logger.exception("agent capabilities failed")
        return {
            "formula": "Agent = Model + Harness",
            "modules": {"service": f"error:{type(exc).__name__}"},
            "endpoints": [
                "GET /api/agent/capabilities",
                "POST /api/agent/run",
                "GET /api/agent/trajectories",
                "GET /api/agent/lessons",
                "GET /api/agent/stats",
            ],
            "error": str(exc),
        }


@router.post("/agent/run")
async def agent_run(request: Request, payload: AgentRunRequest):
    """Run the BB Agent Harness pipeline (offline by default for guests)."""
    if not (payload.message or "").strip():
        raise HTTPException(status_code=400, detail="message is required.")

    mode = (payload.mode or "direct").strip().lower()
    if mode not in ("direct", "crew", "story"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid mode '{payload.mode}'. Expected direct|crew|story.",
        )

    try:
        from agents.harness.service import AgentHarnessService, get_harness_service
    except Exception:
        logger.exception("harness service import failed")
        raise HTTPException(status_code=503, detail="Agent harness unavailable.")

    use_offline = bool(payload.offline) or not _live_provider_available(request)
    provider = None
    if not use_offline:
        provider = getattr(request.app.state, "provider", None)

    service = get_harness_service()
    try:
        result = await service.run(
            payload.message.strip(),
            character_id=payload.character_id or "walter",
            mode=mode,
            language=payload.language or "zh",
            model_route=payload.model_route,
            session_id=payload.session_id,
            use_multi_agent=bool(payload.use_multi_agent) or mode == "crew",
            provider=provider,
            offline=use_offline,
        )
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("agent/run failed")
        raise HTTPException(status_code=500, detail="Internal server error.")


@router.get("/agent/trajectories")
async def agent_trajectories(limit: int = Query(10, ge=1, le=100)):
    """List recent harness trajectories (in-memory + optional JSONL)."""
    try:
        from agents.harness.trajectory import get_trajectory_store
        store = get_trajectory_store()
        items = store.list_recent(n=limit)
        out = []
        for t in items:
            if hasattr(t, "to_dict"):
                out.append(t.to_dict())
            elif isinstance(t, dict):
                out.append(t)
            else:
                out.append({"run_id": getattr(t, "run_id", None)})
        # Newest first for API consumers
        out = list(reversed(out))
        return {"trajectories": out, "count": len(out)}
    except Exception:
        logger.exception("agent trajectories failed")
        return {"trajectories": [], "count": 0}


@router.get("/agent/lessons")
async def agent_lessons(limit: int = Query(50, ge=1, le=200)):
    """List lessons extracted from trajectories."""
    try:
        from agents.harness.evolution import get_lesson_store

        store = get_lesson_store()
        lessons = store.list_lessons(limit=limit)
        out = []
        for lesson in lessons:
            if hasattr(lesson, "to_dict"):
                out.append(lesson.to_dict())
            elif isinstance(lesson, dict):
                out.append(lesson)
            else:
                out.append({"content": str(lesson)})
        return {"lessons": out, "count": len(out)}
    except Exception:
        logger.exception("agent lessons failed")
        return {"lessons": [], "count": 0}


@router.get("/agent/stats")
async def agent_stats():
    """Lightweight harness observability snapshot (read-only, no auth)."""
    try:
        from agents.harness.evolution import get_lesson_store
        from agents.harness.service import capabilities_payload
        from agents.harness.skills import get_skill_registry
        from agents.harness.trajectory import get_trajectory_store

        traj_store = get_trajectory_store()
        # Large n ≈ full in-memory set; list_recent is newest-last.
        all_recent = traj_store.list_recent(n=10_000)
        # Newest first for API consumers (same convention as /agent/trajectories).
        recent_run_ids = [
            t.run_id if hasattr(t, "run_id") else t.get("run_id")
            for t in reversed(all_recent[-5:])
        ]
        recent_run_ids = [rid for rid in recent_run_ids if rid]

        lesson_store = get_lesson_store()
        lessons = lesson_store.list_lessons()
        skills = get_skill_registry().all_skills()
        modules = capabilities_payload().get("modules") or {}

        return {
            "trajectory_count": len(all_recent),
            "lesson_count": len(lessons),
            "skill_count": len(skills),
            "modules": modules,
            "recent_run_ids": recent_run_ids,
        }
    except Exception:
        logger.exception("agent stats failed")
        return {
            "trajectory_count": 0,
            "lesson_count": 0,
            "skill_count": 0,
            "modules": {},
            "recent_run_ids": [],
        }
