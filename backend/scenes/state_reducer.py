"""Deterministic State Reducer (DEC-0005 P4-lite / P2 companion).

Only validated effects may enter the Continuity Board. LLM free-text deltas
remain transitional until full P4.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from agents.continuity_board import normalize_character_id
from agents.narrative_contracts import TurnProposal
from scenes.action_ontology import map_action_verb


def apply_validated_turn(
    board: dict[str, Any],
    turn: TurnProposal,
    *,
    beat_index: int,
) -> dict[str, Any]:
    """Append structured effects from a validated turn. No LLM involved."""
    out = deepcopy(board)
    actor = normalize_character_id(turn.actor_id)
    facts = list(out.get("shared_facts") or [])
    cast = [normalize_character_id(x) for x in (out.get("present_cast") or [])]

    if turn.action:
        verb, _ = map_action_verb(turn.action.verb)
        if verb == "exit" and actor in cast:
            cast = [c for c in cast if c != actor]
            out["present_cast"] = cast
        elif verb == "enter" and actor and actor not in cast:
            cast = list(cast) + [actor]
            out["present_cast"] = cast

        for i, effect in enumerate(turn.action.effects or []):
            text = str(effect).strip()
            if not text:
                continue
            facts.append(
                {
                    "id": f"beat{beat_index}_{actor}_fx_{i}",
                    "text": text,
                    "known_by": list(cast) if cast else [actor],
                    "hidden_from": [],
                    "irreversible": False,
                    "source_beat": beat_index,
                    "source": "state_reducer",
                }
            )

    # Spoken commitment becomes a shared room fact for those present.
    line = (turn.line or "").strip()
    if line:
        knowers = list(cast) if cast else [actor]
        facts.append(
            {
                "id": f"beat{beat_index}_{actor}_said",
                "text": f"{actor} said: {line[:200]}",
                "known_by": knowers,
                "hidden_from": [],
                "irreversible": False,
                "source_beat": beat_index,
                "source": "state_reducer",
            }
        )

    out["shared_facts"] = facts
    out["updated_at_beat"] = max(int(out.get("updated_at_beat") or 0), beat_index + 1)
    return out
