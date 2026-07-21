"""P0: Beat Contract + Turn Proposal schema and SSE mapping."""

from __future__ import annotations

from agents.narrative_contracts import (
    ActionProposal,
    BeatContract,
    TurnProposal,
    turn_to_sse_events,
    validate_turn_against_contract_basic,
)


def test_beat_contract_roundtrip():
    raw = {
        "beat_id": "beat_04",
        "dramatic_role": "progressive",
        "location_id": "saul_office",
        "present_characters": ["Walter", "SAUL"],
        "value_before": "Walter believes Saul can be controlled",
        "value_after": "Saul reveals he has leverage",
        "dramatic_question": "Will Walter threaten Saul or negotiate?",
        "pressure_source": "Saul knows more than Walter expected",
        "required_outcome": ["Walter discovers Saul has independent leverage"],
        "forbidden_outcomes": ["Walter immediately confesses everything"],
    }
    c = BeatContract.model_validate(raw)
    assert c.present_characters == ["walter", "saul"]
    assert c.dramatic_role == "progressive"
    dumped = c.model_dump()
    assert dumped["beat_id"] == "beat_04"


def test_turn_proposal_and_sse_order():
    turn = TurnProposal(
        actor_id="walter",
        observed_facts=["Saul refuses the initial request"],
        private_goal="Recover control without revealing fear",
        fear="Saul may possess evidence",
        relationship_tactic="teacherly correction escalating into implied threat",
        action=ActionProposal(
            verb="walk_to",
            target_id="saul",
            destination_anchor="desk_front",
            preconditions=["walter is standing"],
            effects=["distance becomes close"],
        ),
        inner_monologue="He kept something. Of course he did.",
        speech_act="implied_threat",
        surface_intent="clarify the agreement",
        subtext="I can still hurt you",
        line="I think you may have misunderstood the nature of our arrangement.",
        emotion_state="manipulative",
    )
    events = turn_to_sse_events(turn, backend_character_id="Walter White")
    types = [e["type"] for e in events]
    assert types == ["agent_think", "agent_act", "agent_speak"]
    assert events[0]["data"]["thought_content"].startswith("He kept something")
    assert "walk_to" in events[1]["data"]["action"]
    assert "misunderstood" in events[2]["data"]["content"]
    assert events[2]["data"]["subtext"] == "I can still hurt you"


def test_validator_rejects_absent_actor():
    contract = BeatContract(
        beat_id="b1",
        dramatic_role="setup",
        location_id="lab",
        present_characters=["walter"],
        value_before="a",
        value_after="b",
        dramatic_question="q",
        pressure_source="p",
    )
    turn = TurnProposal(actor_id="jesse", line="Yo.")
    result = validate_turn_against_contract_basic(contract, turn)
    assert result.ok is False
    assert any(i.code == "actor_not_present" for i in result.issues)


def test_validator_accepts_present_speaker():
    contract = BeatContract(
        beat_id="b1",
        dramatic_role="progressive",
        location_id="saul_office",
        present_characters=["walter", "saul"],
        value_before="a",
        value_after="b",
        dramatic_question="q",
        pressure_source="p",
    )
    turn = TurnProposal(
        actor_id="walter",
        observed_facts=["Saul smiled"],
        line="We had an arrangement.",
        emotion_state="tense",
    )
    result = validate_turn_against_contract_basic(contract, turn)
    assert result.ok is True
