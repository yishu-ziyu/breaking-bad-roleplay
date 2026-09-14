"""Performance job contracts. Expression only — never writes Game Kernel state."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

PerformanceJobStatus = Literal["pending", "running", "ready", "fallback"]
PerformanceResultStatus = Literal["ready", "fallback"]


@dataclass(frozen=True)
class PerformanceRequest:
    run_id: str
    action_id: str
    revision: int
    choice_id: str
    speaker: str
    player_is_walter: bool
    settled_consequence: str
    settled_scene_body: str
    settled_facts: tuple[str, ...]
    visible_facts: tuple[str, ...]
    hidden_facts: tuple[str, ...]
    present_characters: tuple[str, ...]
    location: str
    fallback_line: str
    player_confirmed_intent: str
    open_promises: tuple[str, ...]
    resources: dict[str, int]


@dataclass(frozen=True)
class PerformanceResult:
    job_id: str
    run_id: str
    action_id: str
    revision: int
    status: PerformanceResultStatus
    line: str
    speaker: str
    used_fallback: bool
    reason: str | None
    resources_awarded: dict[str, int] = field(default_factory=dict)
    invented_commitments: tuple[str, ...] = ()


@dataclass
class PerformanceJob:
    id: str
    run_id: str
    action_id: str
    revision: int
    character: str
    status: PerformanceJobStatus
    request: PerformanceRequest
    result: PerformanceResult | None = None
    model_route: str = "stepfun/step-3.7-flash"
    prompt_version: str = "night-performance-v1"
    retries: int = 0
    usage: dict[str, Any] = field(default_factory=dict)

    def to_row(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "run_id": self.run_id,
            "action_id": self.action_id,
            "revision": self.revision,
            "character": self.character,
            "status": self.status,
            "kind": "performance",
            "model_route": self.model_route,
            "prompt_version": self.prompt_version,
            "retries": self.retries,
            "usage": dict(self.usage),
        }
