"""Shared generate → sanitize → validate path for Direct / Crew / Story.

Callers still own persistence and SSE. This module only produces an
accepted character result or raises / returns None so unpublished
text cannot leak into later speakers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from agents.character_policy import ActorView
from agents.characters.base import BaseCharacter
from agents.narrative_contracts import (
    BeatContract,
    TurnProposal,
    synthesize_beat_contract,
    turn_proposal_from_character_result,
    validate_turn_against_contract_basic,
)
from agents.speak_sanitize import (
    contains_operational_howto,
    howto_deflection_line,
    sanitize_speak_content,
)
from agents.turn_acceptance import should_publish_turn, strip_unverified_effects
from scenes.validator import validate_world_turn
from scenes.world_mode import WorldMode, parse_world_mode


class TurnGenerationError(RuntimeError):
    """Character LLM failed; caller must not invent a line."""


@dataclass
class AcceptedTurn:
    actor_id: str
    backend_id: str
    result: dict[str, Any]
    turn: TurnProposal
    policy_version: str


def _direct_contract(actor_id: str) -> BeatContract:
    return synthesize_beat_contract(
        beat_index=0,
        scene_desc="direct chat",
        location_id="direct",
        dramatic_role="progressive",
        events=[
            {
                "type": "agent_speak",
                "data": {"character_id": actor_id},
            }
        ],
        active_backend_id=actor_id,
    )


async def generate_accepted_turn(
    agent: BaseCharacter,
    *,
    actor_view: ActorView,
    user_message: str,
    context: Sequence[dict],
    model_route: str,
    backend_id: str,
    policy_turn: bool = False,
    board: dict[str, Any] | None = None,
    world_mode: WorldMode | str = "alternate",
    beat_contract: BeatContract | None = None,
    voice_example: str | None = None,
    language: str = "en",
) -> AcceptedTurn | None:
    """Generate one character turn and hard-validate it.

    Returns None when the turn must not be published.
    """
    try:
        result = await agent.respond_structured(
            context=list(context),
            user_message=user_message,
            model_route=model_route,
            voice_example=voice_example,
            dossier_context=actor_view.prompt_block() or None,
            policy_turn=policy_turn,
        )
    except Exception as exc:
        raise TurnGenerationError(str(exc)) from exc

    line = sanitize_speak_content(str(result.get("reply_text") or ""))
    thinking = sanitize_speak_content(str(result.get("thinking") or ""))
    result = {
        **result,
        "reply_text": line,
        "thinking": thinking or None,
    }
    if not line:
        return None
    if contains_operational_howto(line) or contains_operational_howto(thinking):
        line = howto_deflection_line(actor_view.policy.actor_id, language)
        thinking = None
        result = {**result, "reply_text": line, "thinking": None}

    turn = turn_proposal_from_character_result(
        backend_character_id=backend_id,
        reply_text=line,
        thinking=thinking,
        emotion_state=result.get("emotion_state"),
        character_action=result.get("action"),
        private_goal=str(result.get("private_goal") or ""),
        fear=str(result.get("fear") or ""),
        relationship_tactic=str(result.get("relationship_tactic") or ""),
        speech_act=str(result.get("speech_act") or ""),
        surface_intent=str(result.get("surface_intent") or ""),
        subtext=str(result.get("subtext") or ""),
        observed_facts=list(actor_view.visible_facts or []),
    )
    turn = strip_unverified_effects(turn)
    contract = beat_contract or _direct_contract(backend_id)
    mode = parse_world_mode(world_mode)
    basic = validate_turn_against_contract_basic(contract, turn)
    world = validate_world_turn(contract, turn, board=board, world_mode=mode)
    if not should_publish_turn(basic, world):
        return None
    return AcceptedTurn(
        actor_id=actor_view.policy.actor_id,
        backend_id=backend_id,
        result=result,
        turn=turn,
        policy_version=actor_view.policy.version,
    )
