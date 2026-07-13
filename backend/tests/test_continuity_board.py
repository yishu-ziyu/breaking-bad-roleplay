"""Continuity Board: shared room memory for character agents.

The board is not a judge. It is what the room jointly remembers so later
beats continue from what already happened, and each speaker only gets the
slice they would know.
"""

from __future__ import annotations

import json
from pathlib import Path

from agents.continuity_board import (
    CHARACTER_ID_ALIASES,
    apply_delta_facts,
    default_era_id,
    eras_dir,
    filter_board_for_character,
    format_board_prompt,
    load_era_pack,
    new_session_board,
)


def test_eras_dir_exists_and_has_s3_mid():
    path = eras_dir() / "s3_mid.json"
    assert path.is_file()


def test_load_era_pack_s3_mid():
    pack = load_era_pack("s3_mid")
    assert pack["era"] == "s3_mid"
    assert any(f["id"] == "s3_gus_roof" for f in pack["shared_facts"])


def test_new_session_board_copies_era_seed():
    board = new_session_board(session_id="sess-1", era="s3_mid")
    assert board["session_id"] == "sess-1"
    assert board["era"] == "s3_mid"
    assert board["updated_at_beat"] == 0
    assert len(board["shared_facts"]) >= 1


def test_filter_hides_facts_character_should_not_know():
    board = new_session_board(session_id="s", era="s3_mid")
    # Skyler is hidden_from on s3_gus_roof
    skyler_view = filter_board_for_character(board, "Skyler White")
    known_ids = {f["id"] for f in skyler_view["shared_facts"]}
    assert "s3_gus_roof" not in known_ids
    assert "s3_skyler_suspects" in known_ids

    jesse_view = filter_board_for_character(board, "Jesse Pinkman")
    jesse_ids = {f["id"] for f in jesse_view["shared_facts"]}
    assert "s3_gus_roof" in jesse_ids
    assert "s3_skyler_suspects" not in jesse_ids


def test_filter_accepts_short_and_full_character_ids():
    board = new_session_board(session_id="s", era="s3_mid")
    a = filter_board_for_character(board, "walter")
    b = filter_board_for_character(board, "Walter White")
    assert {f["id"] for f in a["shared_facts"]} == {f["id"] for f in b["shared_facts"]}
    assert "walter" in CHARACTER_ID_ALIASES or "Walter White" in CHARACTER_ID_ALIASES.values()


def test_format_board_prompt_lists_only_known_facts():
    board = new_session_board(session_id="s", era="s3_mid")
    view = filter_board_for_character(board, "jesse")
    text = format_board_prompt(view, character_id="jesse")
    assert "CONTINUITY BOARD" in text
    assert "s3_mid" in text or "Era:" in text
    assert "Gus" in text or "cook" in text.lower()
    # Must not leak Skyler's private household fact to Jesse
    assert "household story is incomplete" not in text


def test_apply_delta_facts_appends_and_marks_knowers():
    board = new_session_board(session_id="s", era="s3_mid")
    before = len(board["shared_facts"])
    board2 = apply_delta_facts(
        board,
        deltas=[
            {
                "target": "Walter White",
                "field": "called_gus",
                "old_value": "no",
                "new_value": "yes — probed whether Gus knows he survived",
            }
        ],
        known_by=["walter", "gus"],
        beat_index=2,
        irreversible=False,
    )
    assert len(board2["shared_facts"]) == before + 1
    assert board2["updated_at_beat"] == 2
    # immutability: original board unchanged
    assert len(board["shared_facts"]) == before
    newest = board2["shared_facts"][-1]
    assert "walter" in newest["known_by"]
    assert newest["source_beat"] == 2


def test_default_era_is_s3_mid():
    assert default_era_id() == "s3_mid"


def test_s3_mid_has_walt_jesse_pair_facts():
    pack = load_era_pack("s3_mid")
    ids = {f["id"] for f in pack["shared_facts"]}
    assert "s3_walt_jesse_hierarchy" in ids
    assert "s3_jesse_trust_ledger" in ids
    board = new_session_board(session_id="s", era="s3_mid")
    skyler = filter_board_for_character(board, "skyler")
    skyler_ids = {f["id"] for f in skyler["shared_facts"]}
    assert "s3_walt_jesse_hierarchy" not in skyler_ids
    jesse = filter_board_for_character(board, "jesse")
    jesse_ids = {f["id"] for f in jesse["shared_facts"]}
    assert "s3_jesse_trust_ledger" in jesse_ids
    assert "s3_pair_room_rule" in jesse_ids
