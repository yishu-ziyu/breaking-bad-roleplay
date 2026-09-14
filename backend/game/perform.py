"""Fulfill a settled night. Never writes kernel state. Never rolls back act()."""

from __future__ import annotations

from typing import Any

from agents.performance import fulfill_performance, request_from_player_view
from game.kernel import player_view, state_from_dict
from game.performance_types import PerformanceJob, PerformanceResult
from game.service import GameService


async def fulfill_settled(
    svc: GameService,
    provider: Any,
    view: dict[str, Any],
    *,
    action_id: str,
    choice_id: str,
) -> dict[str, Any]:
    pending = _pending_job(svc, view["run_id"], int(view["revision"]), action_id)
    if pending is None:
        return svc.get(view["run_id"])
    request = request_from_player_view(view, action_id=action_id, choice_id=choice_id)
    result = await fulfill_performance(_job_from_row(pending, request), provider)
    _persist_result(svc, result, action_id=action_id)
    return svc.get(view["run_id"])


async def fulfill_replay(
    svc: GameService,
    provider: Any,
    run_id: str,
    queued: dict[str, Any],
) -> dict[str, Any]:
    revision = int(queued["revision"])
    checkpoint = svc.store.get_checkpoint(run_id, revision)
    if checkpoint is None:
        return queued
    view = player_view(state_from_dict(checkpoint["state"]))
    view["visibility"] = "player"
    action_id = str(checkpoint.get("source_action_id") or queued.get("job_id") or "replay")
    pending = _pending_job(svc, run_id, revision, action_id) or _job_by_id(
        svc, queued.get("job_id")
    )
    if pending is None:
        return queued
    request = request_from_player_view(view, action_id=action_id, choice_id=action_id)
    result = await fulfill_performance(_job_from_row(pending, request), provider)
    _persist_result(svc, result, action_id=action_id)
    return {"job_id": result.job_id, "revision": revision, "status": result.status}


def _pending_job(
    svc: GameService, run_id: str, revision: int, action_id: str
) -> dict[str, Any] | None:
    matches = [
        row
        for row in svc.store.jobs_for_revision(run_id, revision)
        if row.get("action_id") == action_id and row.get("status") == "pending"
    ]
    return matches[-1] if matches else None


def _job_by_id(svc: GameService, job_id: str | None) -> dict[str, Any] | None:
    if not job_id:
        return None
    return svc.store.get_job(job_id)


def _job_from_row(row: dict[str, Any], request) -> PerformanceJob:
    return PerformanceJob(
        id=row["id"],
        run_id=row["run_id"],
        action_id=str(row.get("action_id") or request.action_id),
        revision=int(row["revision"]),
        character=request.speaker,
        status="pending",
        request=request,
    )


def _persist_result(svc: GameService, result: PerformanceResult, *, action_id: str) -> None:
    with svc.store.unit_of_work():
        svc.store.update_job(result.job_id, status=result.status)
        svc.store.append_event(
            {
                "run_id": result.run_id,
                "revision": result.revision,
                "type": "performance_fallback" if result.used_fallback else "performance_ready",
                "visibility": "player",
                "source_action_id": action_id,
                "payload": {
                    "job_id": result.job_id,
                    "line": result.line,
                    "speaker": result.speaker,
                    "status": result.status,
                    "used_fallback": result.used_fallback,
                    "reason": result.reason,
                },
            }
        )
