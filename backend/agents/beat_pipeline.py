"""Pure helpers for Director beat generation.

Keeps ``DirectorAgent._generate_beat`` as orchestration: planning, speak
realization, and persistence stay on the agent because they need the
provider and DB. These functions have no I/O.
"""

from __future__ import annotations

from typing import Any


def hoist_perspective_speak(
    events: list[dict[str, Any]],
    active_character_id: str | None,
) -> list[dict[str, Any]]:
    """If a perspective character is set, make their first speak the first speak."""
    if not active_character_id:
        return events
    events = list(events)
    target_name = active_character_id
    idx_first_speak = None
    idx_target_speak = None
    for i, evt in enumerate(events):
        if evt.get("type") == "agent_speak" and idx_first_speak is None:
            idx_first_speak = i
        if (
            evt.get("type") == "agent_speak"
            and evt.get("data", {}).get("character_id") == target_name
            and idx_target_speak is None
        ):
            idx_target_speak = i
    if (
        idx_target_speak is not None
        and idx_first_speak is not None
        and idx_target_speak != idx_first_speak
    ):
        target_evt = events.pop(idx_target_speak)
        events.insert(idx_first_speak, target_evt)
    return events


def collect_llm_world_deltas(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for raw_evt in events:
        if raw_evt.get("type") != "world_state_delta":
            continue
        raw_deltas = (raw_evt.get("data") or {}).get("deltas") or []
        if isinstance(raw_deltas, list):
            payload.extend(d for d in raw_deltas if isinstance(d, dict))
    return payload
