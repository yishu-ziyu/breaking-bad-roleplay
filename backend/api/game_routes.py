"""HTTP surface for the six-turn night. Persistence lives in game.service."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from game.perform import fulfill_replay, fulfill_settled
from game.service import GameError, GameService
from game.store import default_store

router = APIRouter()
_SERVICE = GameService(default_store())


def get_game_service() -> GameService:
    return _SERVICE


def get_performance_provider(request: Request):
    if hasattr(request.app.state, "night_performance_provider"):
        return request.app.state.night_performance_provider
    from config import settings

    if settings.app_env == "test":
        return None
    return getattr(request.app.state, "provider", None)


class StartBody(BaseModel):
    seed: int = 1


class ActionBody(BaseModel):
    action_id: str = Field(min_length=1)
    expected_revision: int
    choice_id: str = Field(min_length=1)


class BranchBody(BaseModel):
    revision: int


class ReplayBody(BaseModel):
    revision: int


def _error(exc: GameError) -> JSONResponse:
    status = {
        "not_found": 404,
        "revision_conflict": 409,
        "idempotency_mismatch": 409,
        "illegal_action": 400,
        "already_ended": 409,
    }.get(exc.code, 400)
    return JSONResponse(
        status_code=status,
        content={"code": exc.code, "message": exc.message, **exc.payload},
    )


@router.post("/game/start")
def start_game(body: StartBody, svc: GameService = Depends(get_game_service)):
    return svc.start(seed=body.seed)


@router.get("/game/{run_id}")
def get_game(run_id: str, svc: GameService = Depends(get_game_service)):
    try:
        return svc.get(run_id)
    except GameError as exc:
        return _error(exc)


@router.get("/game/{run_id}/events")
def get_events(
    run_id: str,
    after: int = Query(default=0, ge=0),
    svc: GameService = Depends(get_game_service),
):
    try:
        return {"events": svc.events(run_id, after=after)}
    except GameError as exc:
        return _error(exc)


@router.post("/game/{run_id}/actions")
async def post_action(
    run_id: str,
    body: ActionBody,
    svc: GameService = Depends(get_game_service),
    provider=Depends(get_performance_provider),
):
    try:
        view = svc.act(
            run_id,
            action_id=body.action_id,
            expected_revision=body.expected_revision,
            choice_id=body.choice_id,
        )
        if provider is not None:
            view = await fulfill_settled(
                svc,
                provider,
                view,
                action_id=body.action_id,
                choice_id=body.choice_id,
            )
        return {"view": view}
    except GameError as exc:
        return _error(exc)


@router.post("/game/{run_id}/branches")
def post_branch(run_id: str, body: BranchBody, svc: GameService = Depends(get_game_service)):
    try:
        return svc.branch(run_id, body.revision)
    except GameError as exc:
        return _error(exc)


@router.post("/game/{run_id}/replay")
async def post_replay(
    run_id: str,
    body: ReplayBody,
    svc: GameService = Depends(get_game_service),
    provider=Depends(get_performance_provider),
):
    try:
        queued = svc.replay(run_id, body.revision)
        if provider is not None:
            queued = await fulfill_replay(svc, provider, run_id, queued)
        return queued
    except GameError as exc:
        return _error(exc)
