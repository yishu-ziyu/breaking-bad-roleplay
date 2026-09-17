"""Tests for Direct chat craft + hidden agenda."""

from __future__ import annotations

from agents.direct_chat_craft import (
    DIRECT_CHAT_CRAFT,
    build_direct_craft_block,
    lacks_conversational_advance,
    maybe_turn_directive,
    pick_light_agenda,
)


def test_lacks_advance_flags_empathy_only():
    assert lacks_conversational_advance("我不是不懂。我懂你疼。")
    assert not lacks_conversational_advance("先把手给我看。别再骂了。")


def test_craft_bans_assistant_cadence():
    assert "bullet lists" in DIRECT_CHAT_CRAFT.lower() or "Never use bullet" in DIRECT_CHAT_CRAFT
    assert "how can I help" in DIRECT_CHAT_CRAFT
    assert "quest" in DIRECT_CHAT_CRAFT.lower() or "assistant" in DIRECT_CHAT_CRAFT.lower()


def test_craft_prioritizes_latest_turn_and_blocks_looping():
    lower = DIRECT_CHAT_CRAFT.lower()
    assert "latest" in lower
    assert "怎么办" in DIRECT_CHAT_CRAFT or "next move" in lower
    assert "re-litigate" in lower or "loop" in lower
    assert "advance the talk" in lower
    assert "canon stay" in lower or "graft" in lower


def test_agenda_stable_when_salt_empty():
    a = pick_light_agenda("jesse", relation="partner", salt="")
    b = pick_light_agenda("jesse", relation="partner", salt="")
    assert a == b


def test_forward_ask_gets_turn_directive():
    assert maybe_turn_directive("那你说怎么办？")
    assert maybe_turn_directive("what should we do now")
    assert maybe_turn_directive("随便聊聊") == ""


def test_agenda_is_light_and_character_specific():
    w = pick_light_agenda("walter", relation="former student", salt="a")
    j = pick_light_agenda("jesse", relation="partner", salt="a")
    assert w
    assert j
    assert w != j
    assert len(w) < 200


def test_craft_block_hides_agenda_instruction():
    block = build_direct_craft_block("gus", relation="guest", salt="night")
    assert "Hidden private aim" in block
    assert "never state it aloud" in block.lower() or "Never state" in block
