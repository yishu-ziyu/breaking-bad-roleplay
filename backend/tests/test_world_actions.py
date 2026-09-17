"""Finite world rules: attempted actions are not automatically true."""

from copy import deepcopy

import pytest

from scenes.world_state import ActionIntent, Item, WorldState, resolve_action


@pytest.fixture
def world():
    return WorldState(
        player_id="walter", location="desert", present=["walter", "jesse"],
        items={"cash": Item(label="现金袋", holder="jesse"),
               "tire": Item(label="轮胎", holder="rv", condition="damaged"),
               "note": Item(label="便条", holder="walter")},
    )


def test_cannot_give_an_item_the_player_does_not_hold(world):
    before = world.model_dump()
    result = resolve_action(world, ActionIntent(verb="give", item_id="cash", target_id="jesse"))
    assert not result.accepted
    assert result.state.model_dump() == before
    assert result.effects == []


def test_claim_does_not_repair_damage_or_grant_ownership(world):
    result = resolve_action(world, ActionIntent(verb="say", text="I fixed the tire and have all the money."))
    assert result.accepted
    assert result.state.items["tire"].condition == "damaged"
    assert result.state.items["cash"].holder == "jesse"
    assert result.effects[0]["kind"] == "claim_made"
    assert result.effects[0]["speaker"] == "walter"


def test_transfer_is_causal_conserves_items_and_does_not_mutate_input(world):
    before = deepcopy(world.model_dump())
    result = resolve_action(world, ActionIntent(verb="give", item_id="note", target_id="jesse"))
    assert result.accepted
    assert result.state.items["note"].holder == "jesse"
    assert result.state.clock == world.clock + 1
    assert set(result.state.items) == set(world.items)
    assert world.model_dump() == before


def test_absent_target_and_unknown_item_cannot_be_invented(world):
    assert not resolve_action(world, ActionIntent(verb="give", item_id="note", target_id="gus")).accepted
    assert not resolve_action(world, ActionIntent(verb="take", item_id="new_money")).accepted


def test_unsupported_action_is_explained_without_silent_success(world):
    result = resolve_action(world, ActionIntent(verb="unsupported", text="Teleport to New York"))
    assert not result.accepted
    assert result.reason == "unsupported_action"
    assert result.state.location == "desert"


def test_repeating_a_transferred_item_fails_instead_of_farming_trust(world):
    first = resolve_action(world, ActionIntent(verb="give", item_id="note", target_id="jesse"))
    second = resolve_action(first.state, ActionIntent(verb="give", item_id="note", target_id="jesse"))
    assert not second.accepted
    assert second.state.model_dump() == first.state.model_dump()


def test_observation_never_reveals_unavailable_items(world):
    world.items["private_letter"] = Item(label="私信", holder="gus", known_by=["gus"])
    result = resolve_action(world, ActionIntent(verb="observe", item_id="private_letter"))
    assert not result.accepted
    assert "private_letter" not in world.player_view()["items"]


def test_unconfirmed_offer_is_not_a_mutual_agreement(world):
    result = resolve_action(world, ActionIntent(verb="promise", target_id="jesse", text="I will stay."))
    assert result.accepted
    assert result.effects[0]["kind"] == "promise_offered"
    assert result.state.promises[0]["status"] == "offered"


def test_model_cannot_smuggle_effects_or_another_actor_into_intent():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ActionIntent.model_validate({"verb": "say", "text": "Hello", "effects": {"cash": 1000}})
    with pytest.raises(ValidationError):
        ActionIntent.model_validate({"verb": "give", "actor_id": "gus"})


def test_trust_changes_only_for_observed_fulfillment_not_repeated_pleading(world):
    offer = resolve_action(world, ActionIntent(verb="promise", item_id="note", target_id="jesse", text="I will give you this note."))
    assert not offer.state.trust
    pleading = resolve_action(offer.state, ActionIntent(verb="say", text="Trust me. I am your best friend."))
    assert not pleading.state.trust
    fulfilled = resolve_action(pleading.state, ActionIntent(verb="give", item_id="note", target_id="jesse"))
    assert fulfilled.state.promises[0]["status"] == "fulfilled"
    assert 0.3 < fulfilled.state.trust["jesse"] <= 0.35
    repeated = resolve_action(fulfilled.state, ActionIntent(verb="give", item_id="note", target_id="jesse"))
    assert repeated.state.trust == fulfilled.state.trust


def test_player_view_hides_knowledge_graph_and_unheard_private_promises(world):
    world.items["note"].known_by = ["walter", "jesse"]
    world.claims.extend([
        {"speaker": "jesse", "text": "Walter heard this.", "heard_by": ["walter", "jesse"]},
        {"speaker": "gus", "text": "Walter did not hear this.", "heard_by": ["gus", "mike"]},
    ])
    world.promises.extend([
        {"id": "p-player", "from": "walter", "to": "jesse", "text": "I will return.", "status": "offered"},
        {"id": "p-private", "from": "gus", "to": "mike", "text": "Handle it.", "status": "accepted"},
    ])

    view = world.player_view()

    assert "known_by" not in view["items"]["note"]
    assert view["claims"] == [{"speaker": "jesse", "text": "Walter heard this."}]
    assert [promise["id"] for promise in view["promises"]] == ["p-player"]
    assert "trust" not in view


def test_full_character_name_is_normalized_before_presence_and_transfer_checks(world):
    result = resolve_action(
        world,
        ActionIntent(verb="give", item_id="note", target_id="Jesse Pinkman"),
    )

    assert result.accepted
    assert result.state.items["note"].holder == "jesse"
    assert result.effects[0]["to"] == "jesse"


def test_full_names_in_a_restored_snapshot_are_canonicalized_before_rules(world):
    world.player_id = "Walter White"
    world.present = ["Walter White", "Jesse Pinkman"]
    world.items["note"].holder = "Walter White"
    world.items["note"].known_by = ["Walter White"]

    view = world.player_view()
    assert view["player_id"] == "walter"
    assert view["present"] == ["walter", "jesse"]
    assert view["items"]["note"]["holder"] == "walter"

    result = resolve_action(
        world,
        ActionIntent(verb="give", item_id="note", target_id="Jesse Pinkman"),
    )
    assert result.accepted
    assert result.state.items["note"].holder == "jesse"


def test_item_holder_and_knowledge_aliases_are_normalized_before_rules(world):
    world.items["note"].holder = "Walter White"
    world.items["note"].known_by = ["Walter White", "Jesse Pinkman"]

    result = resolve_action(
        world,
        ActionIntent(verb="give", item_id="note", target_id="Jesse Pinkman"),
    )

    assert result.accepted
    assert result.effects[0]["from"] == "walter"
    assert result.state.items["note"].holder == "jesse"


def test_transient_claim_history_is_bounded_for_long_story_runs(world):
    state = world
    for index in range(80):
        result = resolve_action(
            state,
            ActionIntent(verb="say", text=f"claim {index}"),
        )
        assert result.accepted
        state = result.state

    assert len(state.claims) == 48
    assert state.claims[0]["text"] == "claim 32"
    assert state.claims[-1]["text"] == "claim 79"


def test_unresolved_promises_have_an_explicit_capacity_instead_of_unbounded_growth(world):
    state = world
    for index in range(16):
        result = resolve_action(
            state,
            ActionIntent(verb="promise", target_id="jesse", text=f"promise {index}"),
        )
        assert result.accepted
        state = result.state

    rejected = resolve_action(
        state,
        ActionIntent(verb="promise", target_id="jesse", text="one promise too many"),
    )
    assert not rejected.accepted
    assert rejected.reason == "too_many_open_promises"
