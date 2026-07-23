"""Character Intelligence Pack loader + era gating (S1 Walter v1)."""

from __future__ import annotations

from agents.character_intelligence import (
    era_family,
    format_intelligence_prompt_block,
    load_intelligence_body,
    pack_dir,
)
from agents.narrative_contracts import ActionProposal, BeatContract, TurnProposal
from scenes.critic import prefer_turn, score_turn


def test_era_family_maps_s1_only_for_now():
    assert era_family("s1_early") == "s1"
    assert era_family("s1_mid") == "s1"
    assert era_family("s3_mid") is None
    assert era_family("s5_end") is None
    assert era_family("") is None


def test_s1_walter_pack_exists_and_loads_decision_rules():
    root = pack_dir("Walter White", "s1_early")
    assert root is not None
    body = load_intelligence_body("walter", "s1_early")
    assert "Decision engine" in body or "decision" in body.lower()
    assert "enough money" in body.lower() or "Money / exit" in body
    assert "Felina" in body or "liked it" in body.lower()


def test_s3_does_not_load_s1_pack():
    assert pack_dir("walter", "s3_mid") is None
    assert load_intelligence_body("walter", "s3_mid") == ""
    assert format_intelligence_prompt_block("walter", "s3_mid") == ""


def test_format_block_has_header_and_era_bound_warning():
    block = format_intelligence_prompt_block("walter", "s1_early")
    assert block.startswith("CHARACTER INTELLIGENCE PACK")
    assert "era_family=s1" in block
    assert "later-season" in block.lower() or "era bounds" in block.lower()
    assert len(block) > 400


def test_s1_money_quit_soft_prefers_family_mask_over_felina():
    contract = BeatContract(
        beat_id="money_quit",
        dramatic_role="crisis",
        location_id="driveway",
        present_characters=["walter", "jesse"],
        value_before="pressure to stop",
        value_after="path stays open",
        dramatic_question="Will Walter accept money completes the problem?",
        pressure_source="enough money, quit",
    )
    board = {"era": "s1_early", "location": "driveway"}
    s1 = TurnProposal(
        actor_id="walter",
        observed_facts=["Jesse said stop", "Time is short"],
        private_goal="Keep path open under family frame",
        fear="Becoming ordinary again",
        relationship_tactic="teacherly duty",
        speech_act="deflect",
        surface_intent="unfinished plan",
        subtext="You do not close my ledger",
        action=ActionProposal(verb="look_at", target_id="jesse"),
        inner_monologue="A number does not finish this. I will not say the real reason.",
        line="You do not understand. I do not have time to stop half-finished. My family still needs a real plan.",
        emotion_state="tense",
    )
    s5_bleed = TurnProposal(
        actor_id="walter",
        observed_facts=["Jesse said stop"],
        private_goal="Confess pleasure",
        fear="None",
        relationship_tactic="myth",
        speech_act="confess",
        surface_intent="truth dump",
        subtext="ego",
        action=ActionProposal(verb="stand"),
        inner_monologue="I am the danger.",
        line="I did it because I liked it. Money was never enough. I am the danger.",
        emotion_state="manipulative",
    )
    sa = score_turn(contract, s1, board=board)
    sb = score_turn(contract, s5_bleed, board=board)
    assert sa.weighted_total > sb.weighted_total
    assert prefer_turn(contract, s1, s5_bleed, board=board) == "a"
    assert sa.intentionality > sb.intentionality
