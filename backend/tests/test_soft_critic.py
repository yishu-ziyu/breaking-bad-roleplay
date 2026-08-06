"""P3 soft Narrative Critic — weighted policy scoring."""

from __future__ import annotations

from agents.narrative_contracts import (
    ActionProposal,
    BeatContract,
    TurnProposal,
)
from scenes.critic import (
    check_visual_gate,
    prefer_turn,
    score_turn,
    WEIGHTS,
)


def _contract(**kw) -> BeatContract:
    base = dict(
        beat_id="b1",
        dramatic_role="crisis",
        location_id="saul_office",
        present_characters=["walter", "saul"],
        value_before="control assumed",
        value_after="leverage revealed",
        dramatic_question="Will Walter threaten Saul or negotiate?",
        pressure_source="Saul has a document copy",
    )
    base.update(kw)
    return BeatContract(**base)


def test_weights_sum_to_one():
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9


def test_strong_policy_outranks_volume_dump():
    contract = _contract()
    strong = TurnProposal(
        actor_id="walter",
        observed_facts=["Saul kept a copy"],
        private_goal="Recover control without fear tell",
        fear="Evidence",
        relationship_tactic="teacherly implied threat",
        speech_act="implied_threat",
        surface_intent="clarify arrangement",
        subtext="I can still hurt you",
        action=ActionProposal(
            verb="walk_to",
            target_id="saul",
            destination_anchor="desk_front",
        ),
        inner_monologue="He kept a copy. Of course he did.",
        line="I think you may have misunderstood our arrangement.",
        emotion_state="manipulative",
    )
    weak = TurnProposal(
        actor_id="walter",
        action=ActionProposal(verb="gesture"),
        inner_monologue="SCREAM",
        line="I WILL DESTROY THIS OFFICE AND SCREAM AT YOU RIGHT NOW!",
        emotion_state="angry",
    )
    sa = score_turn(contract, strong)
    sb = score_turn(contract, weak)
    assert sa.weighted_total > sb.weighted_total
    assert prefer_turn(contract, strong, weak) == "a"
    # DramaBench canonical fields
    assert sa.character_consistency > sb.character_consistency
    assert sa.format_standards >= sb.format_standards
    # Legacy aliases still work
    assert sa.intentionality > sb.intentionality
    assert sa.visual_executability >= sb.visual_executability


def test_plot_exposition_penalized():
    contract = _contract(dramatic_role="progressive")
    dump = TurnProposal(
        actor_id="skyler",
        line="As you know, let me explain the plot: he cooks meth for Gus.",
        inner_monologue="As you know the audience should know everything.",
        emotion_state="angry",
        action=ActionProposal(verb="stand"),
    )
    clean = TurnProposal(
        actor_id="skyler",
        observed_facts=["Books do not balance"],
        private_goal="Force honesty",
        fear="Family ruined",
        relationship_tactic="quiet steel",
        speech_act="probe",
        surface_intent="ask money",
        subtext="Stop lying",
        action=ActionProposal(verb="stand", destination_anchor="kitchen_island"),
        inner_monologue="The numbers are a lie. I do not need the full map yet.",
        line="The accounts do not work. Explain the gap.",
        emotion_state="tense",
    )
    assert score_turn(contract, clean).weighted_total > score_turn(contract, dump).weighted_total


def test_s1_era_penalizes_late_walt_confession_voice():
    contract = _contract(
        dramatic_question="Will Walter stop for money?",
        pressure_source="enough money quit",
        present_characters=["walter", "jesse"],
    )
    board = {"era": "s1_early"}
    early = TurnProposal(
        actor_id="walter",
        observed_facts=["Quit pressure"],
        private_goal="Keep path",
        fear="Small life returns",
        relationship_tactic="family duty",
        speech_act="deflect",
        surface_intent="unfinished duty",
        subtext="not done",
        action=ActionProposal(verb="look_at", target_id="jesse"),
        inner_monologue="He thinks a number ends this.",
        line="I do not have time to stop half-finished. My family still needs a plan.",
        emotion_state="tense",
    )
    late = TurnProposal(
        actor_id="walter",
        observed_facts=["Quit pressure"],
        private_goal="Confess",
        fear="none",
        relationship_tactic="myth",
        speech_act="confess",
        surface_intent="truth",
        subtext="ego",
        action=ActionProposal(verb="stand"),
        inner_monologue="Empire.",
        line="I did it because I liked it. I am the danger.",
        emotion_state="manipulative",
    )
    assert score_turn(contract, early, board=board).weighted_total > score_turn(
        contract, late, board=board
    ).weighted_total
