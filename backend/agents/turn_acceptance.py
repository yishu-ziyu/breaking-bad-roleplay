"""Publish gate for Story (and later Direct/Crew) turns.

A TurnProposal is not player-visible until it becomes an AcceptedTurn.
Failed validation must not leak into SSE, persistence, dossiers, the
Continuity Board, or later speakers' context.

PR1 scope: deterministic hard-rule gate only. Personality critic is later.
"""

from __future__ import annotations

from typing import Any

from agents.narrative_contracts import (
    TurnProposal,
    ValidationResult,
    backend_to_actor_id,
    validate_turn_against_contract_basic,
)

# Hard errors that drop the whole act/think/speak group — not just the board write.
PUBLISH_BLOCKING_CODES = frozenset(
    {
        "knowledge_boundary",
        "actor_removed",
        "actor_not_present",
        "empty_turn",
        "target_not_present",
        "forbidden_outcome",
    }
)


def blocking_issues(*results: ValidationResult) -> list:
    out = []
    for result in results:
        for issue in result.issues:
            if issue.severity == "error" and issue.code in PUBLISH_BLOCKING_CODES:
                out.append(issue)
    return out


def should_publish_turn(*results: ValidationResult) -> bool:
    """True only when every result is ok and has no publish-blocking error."""
    if not results:
        return False
    if any(not result.ok for result in results):
        return False
    return not blocking_issues(*results)


def strip_unverified_effects(turn: TurnProposal) -> TurnProposal:
    """Free-text action.effects are unverified claims. Drop them before commit."""
    if not turn.action or not turn.action.effects:
        return turn
    return turn.model_copy(
        update={"action": turn.action.model_copy(update={"effects": []})}
    )


def drop_character_group(
    events: list[dict[str, Any]],
    *,
    backend_character_id: str,
    speak_index: int,
) -> tuple[list[dict[str, Any]], int]:
    """Remove the unpublished speak and its director-draft act/think for this actor.

    Returns (events, next_index) pointing at the item that slid into speak_index.
    """
    cid = str(backend_character_id)
    # Drop the speak first.
    if 0 <= speak_index < len(events) and events[speak_index].get("type") == "agent_speak":
        events.pop(speak_index)
    # Walk backward: remove adjacent unpublished think/act for the same character.
    j = speak_index - 1
    while j >= 0:
        prev = events[j]
        ptype = prev.get("type")
        pdata = prev.get("data") if isinstance(prev.get("data"), dict) else {}
        if pdata.get("character_id") != cid:
            break
        if ptype == "agent_think":
            events.pop(j)
            speak_index -= 1
            j -= 1
            continue
        if ptype == "agent_act" and pdata.get("source") != "character_policy":
            events.pop(j)
            speak_index -= 1
            j -= 1
            continue
        break
    return events, max(speak_index, 0)


def revalidate_events_after_rewrite(
    events: list[dict[str, Any]],
    *,
    contract: Any,
    board: dict[str, Any] | None,
    world_mode: str = "alternate",
) -> list[dict[str, Any]]:
    """Re-run hard checks on the text that will actually be shown.

    Dubbing rewrite (and any other post-pass) produces a new candidate. A
    previous ``turn_validation_ok`` flag does not travel with rewritten text.
    """
    from scenes.validator import validate_world_turn

    if contract is None:
        return events
    i = 0
    while i < len(events):
        evt = events[i]
        if evt.get("type") != "agent_speak":
            i += 1
            continue
        data = evt.get("data") if isinstance(evt.get("data"), dict) else {}
        cid = str(data.get("character_id") or "")
        think = ""
        for j in range(i - 1, -1, -1):
            prev = events[j]
            pdata = prev.get("data") if isinstance(prev.get("data"), dict) else {}
            if prev.get("type") == "agent_think" and pdata.get("character_id") == cid:
                think = str(pdata.get("thought_content") or "")
                break
            if pdata.get("character_id") != cid:
                break
        turn = TurnProposal(
            actor_id=backend_to_actor_id(cid),
            line=str(data.get("content") or ""),
            inner_monologue=think,
        )
        basic = validate_turn_against_contract_basic(contract, turn)
        world = validate_world_turn(
            contract, turn, board=board, world_mode=world_mode  # type: ignore[arg-type]
        )
        if not should_publish_turn(basic, world):
            events, i = drop_character_group(
                events, backend_character_id=cid, speak_index=i
            )
            continue
        i += 1
    return events
