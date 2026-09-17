"""Identity guard: player is never addressed as the character."""

from agents.identity_guard import (
    addresses_player_as_self,
    player_identity_block,
)


def test_jesse_vocative_detected():
    bad = "杰西我跟你说，想清楚再动手。杰西，你想清楚了吗？"
    assert addresses_player_as_self(bad, "jesse")
    assert addresses_player_as_self("Jesse, think it through.", "jesse")


def test_normal_jesse_line_ok():
    ok = "操。你想清楚没有。跟我走。"
    assert not addresses_player_as_self(ok, "jesse")


def test_identity_block_names_relation():
    block = player_identity_block("jesse", relation="partner")
    assert "NOT you" in block
    assert "partner" in block
    assert "杰西" in block
    assert "canon" in block.lower() or "project" in block.lower()
