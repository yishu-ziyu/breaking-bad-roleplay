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

        # Free-text action.effects are unverified claims. Ontology verbs
        # (enter/exit) already mutate present_cast above; do not treat
        # model-authored effect strings as world facts.

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


def board_from_world(world) -> dict[str, Any]:
    """Character-specific projection of the authoritative Story snapshot."""
    from agents.continuity_board import new_session_board

    if world.scenario_id == "desert_crisis":
        board = new_session_board(
            session_id="story-projection",
            era="s1_early",
            location=world.location,
            present_cast=list(world.present),
            world_clock=(0, "night", "clear"),
        )
    else:
        # An open custom Story has no justified canon-era pack. Injecting the
        # old s3_mid default here silently gave characters facts the player
        # never established. Keep only the facts produced by this run.
        board = {
            "session_id": "story-projection",
            "era": "custom",
            "label": None,
            "label_zh": None,
            "location": world.location,
            "world_clock": (0, "night", "clear"),
            "present_cast": list(world.present),
            "shared_facts": [],
            "open_tensions": [],
            "irreversible_costs": [],
            "player_relation": {},
            "updated_at_beat": 0,
        }
    facts = list(board.get("shared_facts") or [])
    for key, item in world.items.items():
        facts.append({
            "id": f"item:{key}", "text": f"{item.label} ({key}): holder={item.holder}; condition={item.condition}",
            "known_by": list(item.known_by), "hidden_from": [], "source": "world_rules",
        })
    for index, claim in enumerate(world.claims[-24:]):
        facts.append({
            "id": f"claim:{index}", "text": f"{claim['speaker']} said (a claim, not proof): {claim['text']}",
            "known_by": list(claim["heard_by"]), "hidden_from": [], "source": "accepted_turn",
        })
    for promise in world.promises:
        facts.append({
            "id": f"promise:{promise['id']}",
            "text": f"{promise['from']} promised {promise['to']}: {promise['text']}; status={promise['status']}",
            "known_by": [promise["from"], promise["to"]], "hidden_from": [], "source": "world_rules",
        })
    board["shared_facts"] = facts
    # Every runtime-v1 world is authoritative for physical effects. The
    # difference above is only whether a authored canon-era pack is justified.
    board["authoritative"] = True
    board["player_actor_id"] = world.player_id
    return board
