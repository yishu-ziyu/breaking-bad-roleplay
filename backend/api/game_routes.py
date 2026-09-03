"""P0 Game Kernel HTTP contract. No LLM, no database."""

from __future__ import annotations

from typing import Any
import logging
import random

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import json

from agents.ai_runtime_client import AiRuntimeClient
from config import settings
from game.actions import legal_actions
from game.events import template_performance
from game.reducer import apply_action, start_night
from game.store import StoredGame, game_store

router = APIRouter()
logger = logging.getLogger(__name__)


def _ai_client() -> AiRuntimeClient:
    return AiRuntimeClient(settings.ai_runtime_url, settings.ai_runtime_timeout_ms)


def _performance_payload(record: StoredGame, resolution: dict[str, Any] | None = None) -> dict[str, Any]:
    state = record.state
    beat = (resolution or record.last_resolution or {}).get("resolved_beat") or {
        "player_action": {"id": "opening"},
        "visible_state": state.visible(),
    }
    return {
        "request_id": f"{state.game_id}:{state.turn}",
        "game_id": state.game_id,
        "turn": state.turn,
        "character_id": "walter",
        "language": record.language,
        "resolved_beat": beat,
        "character_memory": {"advisory": True, "flags": sorted(state.flags)},
    }


async def attach_performance(
    record: StoredGame,
    resolution: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Call the sidecar after GameState is already committed. Never writes state."""
    fallback = template_performance(
        (resolution or {}).get("resolved_beat")
        or {"player_action": {"id": "opening"}, "visible_state": record.state.visible()},
        language=record.language,
    )
    if settings.ai_runtime != "pi":
        return fallback
    try:
        result = await _ai_client().perform(_performance_payload(record, resolution))
        return result or fallback
    except Exception:
        logger.warning("ai-runtime failed after kernel commit; using fallback", exc_info=True)
        return fallback


class GameStartRequest(BaseModel):
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)
    language: str = "en"


class GameActionRequest(BaseModel):
    action_id: str = Field(..., min_length=1, max_length=80)


def _public_game(record: StoredGame, *, resolution: dict[str, Any] | None = None) -> dict[str, Any]:
    state = record.state
    payload: dict[str, Any] = {
        "game_id": state.game_id,
        "state": state.to_dict(),
        "visible_state": state.visible(),
        "event": record.event,
        "available_actions": legal_actions(state),
        "ending": state.ending,
        "performance": template_performance(
            {
                "player_action": {"id": (resolution or {}).get("action", {}).get("id") or "opening"},
                "visible_state": state.visible(),
            },
            language=record.language,
        ),
    }
    if resolution is not None:
        payload.update(resolution)
    elif record.last_resolution is not None:
        payload.update(record.last_resolution)
    return payload


@router.post("/game/start")
async def game_start(payload: GameStartRequest) -> dict[str, Any]:
    seed = payload.seed if payload.seed is not None else random.SystemRandom().randint(1, 10_000)
    night = start_night(seed=seed)
    record = StoredGame(
        state=night.state,
        event=night.event,
        last_resolution=None,
        language="zh" if payload.language == "zh" else "en",
    )
    game_store.put(record)
    public = _public_game(record)
    public["performance"] = await attach_performance(record)
    return public


@router.get("/game/runtime/health")
async def game_runtime_health() -> dict[str, Any]:
    if settings.ai_runtime != "pi":
        return {"status": "legacy", "ai_runtime": "legacy"}
    health = await _ai_client().health()
    return {
        "status": "ok" if health else "offline",
        "ai_runtime": "pi",
        "sidecar": health,
    }


@router.get("/game/{game_id}")
async def game_get(game_id: str) -> dict[str, Any]:
    record = game_store.get(game_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Unknown game")
    return _public_game(record)


@router.post("/game/{game_id}/action")
async def game_action(game_id: str, payload: GameActionRequest) -> dict[str, Any]:
    record = game_store.get(game_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Unknown game")
    try:
        resolved = apply_action(record.state, payload.action_id)
    except ValueError as exc:
        message = str(exc)
        if "unknown" in message:
            raise HTTPException(status_code=400, detail=message) from exc
        if "ended" in message:
            raise HTTPException(status_code=409, detail=message) from exc
        raise HTTPException(status_code=400, detail=message) from exc

    settlement = resolved.to_dict()
    record.state = resolved.next_state
    record.event = resolved.next_event
    record.last_resolution = {
        "previous_state": settlement["previous_state"],
        "action": settlement["action"],
        "resolved_effects": settlement["resolved_effects"],
        "npc_actions": settlement["npc_actions"],
        "triggered_debts": settlement["triggered_debts"],
        "next_state": settlement["next_state"],
        "next_event": settlement["next_event"],
        "ending": settlement["ending"],
        "resolved_beat": settlement["resolved_beat"],
    }
    game_store.put(record)
    # Kernel is committed. AI failure must not roll this back.
    performance = await attach_performance(record, record.last_resolution)
    if record.state.ended:
        try:
            await _ai_client().dispose(record.state.game_id)
        except Exception:
            logger.info("ai-runtime dispose after ending skipped")
    logger.info(
        "game_action game_id=%s turn=%s action=%s ending=%s",
        game_id,
        resolved.next_state.turn,
        payload.action_id,
        (resolved.ending or {}).get("id"),
    )
    public = _public_game(record, resolution=record.last_resolution)
    public["performance"] = performance
    return public


@router.post("/game/{game_id}/perform/stream")
async def game_perform_stream(game_id: str) -> StreamingResponse:
    record = game_store.get(game_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Unknown game")
    payload = _performance_payload(record)

    async def events():
        if settings.ai_runtime != "pi":
            text = template_performance(
                record.last_resolution["resolved_beat"] if record.last_resolution else {
                    "player_action": {"id": "opening"},
                    "visible_state": record.state.visible(),
                },
                language=record.language,
            )["reply_text"]
            yield f"event: content\ndata: {json.dumps({'type': 'content', 'text': text})}\n\n"
            yield "event: done\ndata: {\"type\": \"done\"}\n\n"
            return
        async for item in _ai_client().stream(payload):
            if item["type"] in {"thinking", "thinking_delta"}:
                continue
            yield f"event: {item['type']}\ndata: {item['data']}\n\n"
        yield "event: done\ndata: {\"type\": \"done\"}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
