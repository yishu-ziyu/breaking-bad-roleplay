"""P0 Game Kernel HTTP contract. No LLM, no database."""

from __future__ import annotations

from typing import Any
import logging
import random

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from game.actions import legal_actions
from game.events import template_performance
from game.reducer import apply_action, start_night
from game.store import StoredGame, game_store

router = APIRouter()
logger = logging.getLogger(__name__)


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
    return _public_game(record)


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
    # Template performance is attached by the reducer; keep it language-aware here.
    settlement["performance"] = template_performance(
        resolved.resolved_beat(),
        language=record.language,
    )
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
    logger.info(
        "game_action game_id=%s turn=%s action=%s ending=%s",
        game_id,
        resolved.next_state.turn,
        payload.action_id,
        (resolved.ending or {}).get("id"),
    )
    return _public_game(record, resolution=record.last_resolution)
