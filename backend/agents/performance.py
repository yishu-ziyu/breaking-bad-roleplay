"""Enqueue and fulfill performance jobs on the existing Provider.

LLM output is expression only. Failures become a fallback line.
Settlement (resources, promises, revision) is never written here.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any, Protocol

import httpx

from agents.narrative_contracts import backend_to_actor_id
from agents.performance_validate import parse_performance_payload, validate_performance_payload
from game.performance_types import PerformanceJob, PerformanceRequest, PerformanceResult

PROMPT_VERSION = "night-performance-v1"


class JobSink(Protocol):
    def put_job(self, row: dict[str, Any]) -> None: ...


class PerformanceProvider(Protocol):
    async def call_model(
        self,
        messages: list[dict],
        model_route: str,
        max_tokens: int = 256,
    ) -> str: ...


def request_from_player_view(
    view: dict[str, Any],
    *,
    action_id: str,
    choice_id: str,
    hidden_facts: tuple[str, ...] = (),
) -> PerformanceRequest:
    scene = view.get("scene") or {}
    speaker_raw = str(scene.get("speaker") or "jesse")
    speaker = backend_to_actor_id(speaker_raw) or speaker_raw.strip().lower() or "jesse"
    consequence = str(view.get("last_consequence") or "")
    body = str(scene.get("body") or "")
    settled: list[str] = [str(item) for item in (view.get("known") or [])]
    if consequence:
        settled.append(consequence)
    if body:
        settled.append(body)
    for entry in view.get("history") or []:
        text = str(entry.get("text") or "")
        if text:
            settled.append(text)
    visible = [str(item) for item in (view.get("known") or [])]
    if body:
        visible.append(body)
    if consequence:
        visible.append(consequence)
    present = ["walter"]
    if speaker not in present:
        present.append(speaker)
    blob = " ".join(settled)
    for name, aid in (("杰西", "jesse"), ("斯凯勒", "skyler"), ("索尔", "saul")):
        if name in blob and aid not in present:
            present.append(aid)
    last_player = next(
        (
            entry
            for entry in reversed(view.get("history") or [])
            if entry.get("source") == "player"
        ),
        None,
    )
    intent = str((last_player or {}).get("text") or choice_id)
    promises = tuple(
        str(item.get("label") or item.get("id") or "")
        for item in (view.get("promises") or [])
    )
    fallback = body or consequence or "这一拍已经发生。"
    return PerformanceRequest(
        run_id=str(view["run_id"]),
        action_id=action_id,
        revision=int(view["revision"]),
        choice_id=choice_id,
        speaker=speaker,
        player_is_walter=True,
        settled_consequence=consequence,
        settled_scene_body=body,
        settled_facts=tuple(settled),
        visible_facts=tuple(visible),
        hidden_facts=tuple(hidden_facts),
        present_characters=tuple(present),
        location=str(view.get("location") or ""),
        fallback_line=fallback,
        player_confirmed_intent=intent,
        open_promises=promises,
        resources=dict(view.get("resources") or {}),
    )


def enqueue_performance(
    run_id: str,
    action_id: str,
    revision: int,
    request: PerformanceRequest,
    *,
    sink: JobSink | None = None,
) -> PerformanceJob:
    if (
        request.run_id != run_id
        or request.action_id != action_id
        or int(request.revision) != int(revision)
    ):
        raise ValueError("performance request identity mismatch")
    job = PerformanceJob(
        id=str(uuid.uuid4()),
        run_id=run_id,
        action_id=action_id,
        revision=int(revision),
        character=request.speaker,
        status="pending",
        request=request,
        prompt_version=PROMPT_VERSION,
    )
    if sink is not None:
        sink.put_job(job.to_row())
    return job


async def fulfill_performance(
    job: PerformanceJob,
    provider: PerformanceProvider,
    *,
    timeout_s: float = 12.0,
    model_route: str | None = None,
) -> PerformanceResult:
    request = job.request
    job.status = "running"
    route = model_route or job.model_route
    try:
        raw = await asyncio.wait_for(
            provider.call_model(_messages(request), route, max_tokens=256),
            timeout=timeout_s,
        )
    except Exception as exc:
        return _fallback(job, request, _classify(exc))
    try:
        payload = parse_performance_payload(raw)
    except ValueError:
        return _fallback(job, request, "format")
    issues = validate_performance_payload(payload, request)
    if issues:
        return _fallback(job, request, ";".join(issues))
    line = str(payload.get("line") or "").strip()
    speaker = backend_to_actor_id(payload.get("speaker") or request.speaker) or request.speaker
    result = PerformanceResult(
        job_id=job.id,
        run_id=request.run_id,
        action_id=request.action_id,
        revision=request.revision,
        status="ready",
        line=line,
        speaker=speaker,
        used_fallback=False,
        reason=None,
        resources_awarded={},
        invented_commitments=(),
    )
    job.status = "ready"
    job.result = result
    return result


def _messages(request: PerformanceRequest) -> list[dict[str, str]]:
    facts = "\n".join(f"- {item}" for item in request.visible_facts) or "- （无）"
    promises = "\n".join(f"- {item}" for item in request.open_promises) or "- （无未兑现承诺可复述）"
    return [
        {
            "role": "system",
            "content": (
                "你在演出一局已经结算的夜晚。只写台词，不改规则。\n"
                "禁止发放资源、发明沃尔特的新承诺、修改 revision、声称没有发生的事。\n"
                "玩家就是沃尔特。不要替他答应任何新的事。\n"
                f"角色：{request.speaker}\n"
                f"地点：{request.location}\n"
                f"已发生：{request.settled_consequence}\n"
                f"可见事实：\n{facts}\n"
                f"可复述的旧承诺：\n{promises}\n"
                f"玩家已确认的意图：{request.player_confirmed_intent}\n"
                '只返回 JSON：{"speaker":"<actor_id>","line":"<一句台词>"}'
            ),
        },
        {
            "role": "user",
            "content": request.settled_scene_body or request.fallback_line,
        },
    ]


def _fallback(job: PerformanceJob, request: PerformanceRequest, reason: str) -> PerformanceResult:
    result = PerformanceResult(
        job_id=job.id,
        run_id=request.run_id,
        action_id=request.action_id,
        revision=request.revision,
        status="fallback",
        line=request.fallback_line or request.settled_scene_body or "这一拍已经发生。",
        speaker=request.speaker,
        used_fallback=True,
        reason=reason,
        resources_awarded={},
        invented_commitments=(),
    )
    job.status = "fallback"
    job.result = result
    return result


def _classify(exc: BaseException) -> str:
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    if isinstance(exc, httpx.HTTPStatusError):
        code = int(getattr(exc.response, "status_code", 0) or 0)
        if code == 429:
            return "429"
        return f"provider:{code}"
    return f"provider:{type(exc).__name__}"
