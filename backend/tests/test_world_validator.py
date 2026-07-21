"""P2: hard world validation + action ontology + reducer."""

from __future__ import annotations

from agents.narrative_contracts import (
    ActionProposal,
    BeatContract,
    TurnProposal,
)
from scenes.action_ontology import map_action_verb
from scenes.state_reducer import apply_validated_turn
from scenes.validator import validate_world_turn


def _contract(**kwargs):
    base = dict(
        beat_id="beat_01",
        dramatic_role="progressive",
        location_id="saul_office",
        present_characters=["walter", "saul"],
        value_before="a",
        value_after="b",
        dramatic_question="q",
        pressure_source="p",
        forbidden_outcomes=["Walter immediately confesses everything"],
    )
    base.update(kwargs)
    return BeatContract(**base)


def test_map_action_verb_synonyms_and_fallback():
    assert map_action_verb("walks toward desk")[0] == "walk_to"
    assert map_action_verb("sits")[0] == "sit"
    verb, mapped = map_action_verb("teleports into orbit")
    assert verb == "idle_tense"
    assert mapped is True


def test_reject_absent_and_dead_actor():
    contract = _contract()
    turn = TurnProposal(actor_id="jesse", line="Yo.")
    r = validate_world_turn(contract, turn)
    assert r.ok is False
    assert any(i.code == "actor_not_present" for i in r.issues)

    board = {
        "present_cast": ["walter", "saul"],
        "shared_facts": [],
        "irreversible_costs": ["Gus is dead after the nursing home."],
    }
    turn_gus = TurnProposal(actor_id="gus", line="Hello.")
    contract_gus = _contract(present_characters=["gus", "walter"])
    r2 = validate_world_turn(contract_gus, turn_gus, board=board)
    assert r2.ok is False
    assert any(i.code == "actor_removed" for i in r2.issues)


def test_knowledge_boundary_blocks_hidden_fact():
    contract = _contract(present_characters=["skyler", "walter"])
    board = {
        "present_cast": ["skyler", "walter"],
        "shared_facts": [
            {
                "id": "s3_gus_roof",
                "text": (
                    "The cook partnership operates under Gus Fring's "
                    "organization and standards."
                ),
                "known_by": ["walter", "jesse", "gus"],
                "hidden_from": ["skyler"],
            }
        ],
        "irreversible_costs": [],
    }
    # Skyler must not voice Gus-organization cook detail.
    bad = TurnProposal(
        actor_id="skyler",
        line=(
            "I know the cook partnership operates under Gus Fring's "
            "organization and standards."
        ),
        observed_facts=[],
    )
    r = validate_world_turn(contract, bad, board=board, world_mode="alternate")
    assert r.ok is False
    assert any(i.code == "knowledge_boundary" for i in r.issues)

    good = TurnProposal(
        actor_id="skyler",
        line="Something is wrong with our books.",
        observed_facts=["Walter is late again"],
    )
    r2 = validate_world_turn(contract, good, board=board, world_mode="alternate")
    assert r2.ok is True


def test_reducer_applies_exit_and_line_fact():
    board = {
        "present_cast": ["walter", "saul"],
        "shared_facts": [],
        "updated_at_beat": 0,
    }
    turn = TurnProposal(
        actor_id="walter",
        line="We had an arrangement.",
        action=ActionProposal(verb="exit", effects=["Walter left the office"]),
    )
    out = apply_validated_turn(board, turn, beat_index=3)
    assert "walter" not in out["present_cast"]
    assert "saul" in out["present_cast"]
    texts = [f["text"] for f in out["shared_facts"]]
    assert any("Walter left" in t for t in texts)
    assert any("said:" in t for t in texts)
