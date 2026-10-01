"""Cast relationship table: show-wide public facts only (issue #81).

Given the eight playable characters,
When a speaker names or shares a room with another,
Then the table can supply who-is-who, address, and barely-knows facts
that are checkable against the show — never era spoilers.
"""

from __future__ import annotations

from agents.cast_relations import (
    ACTOR_IDS,
    PAIR_ROWS,
    collect_other_ids,
    crew_player_scope_note,
    detect_mentioned_ids,
    flag_relation_errors,
    format_cast_relations_block,
    household_facts,
    row_for,
)


def test_every_directed_pair_has_a_row():
    """Given the playable cast, every speaker→other pair is filled so the model cannot guess."""
    missing = []
    for speaker in ACTOR_IDS:
        for other in ACTOR_IDS:
            if speaker == other:
                continue
            if row_for(speaker, other) is None:
                missing.append(f"{speaker}->{other}")
    assert missing == []


def test_jesse_hank_is_not_family_and_not_jesse_house():
    """Canon: Hank is Walt's brother-in-law (Marie/Skyler); DEA hunting Jesse; not Jesse's kin."""
    row = row_for("jesse", "hank")
    assert row is not None
    blob = f"{row.who} {row.address} {row.familiarity}".lower()
    assert "brother-in-law" in blob or "in-law" in blob
    assert "dea" in blob
    assert "not" in blob and ("family" in blob or "household" in blob or "kin" in blob)
    assert row.familiarity == "adversary"
    household = " ".join(household_facts("jesse", ["hank"])).lower()
    assert "jesse" in household
    assert "not" in household
    assert "white" in household


def test_jesse_calls_walt_mr_white():
    """Canon: Jesse almost never says 'Walter'; he says 'Mr. White'."""
    row = row_for("jesse", "walter")
    assert row is not None
    assert "Mr. White" in row.address
    assert "Walter" in row.address or "沃尔特" in row.address


def test_marie_saul_barely_know_not_family():
    """Canon: Saul is a flashy criminal lawyer; Marie has no household tie to him."""
    row = row_for("marie", "saul")
    assert row is not None
    assert row.familiarity == "barely"
    blob = row.who.lower()
    assert "lawyer" in blob or "attorney" in blob
    assert "not" in blob


def test_no_era_spoiler_tokens_in_table():
    """Era / Continuity Board owns seasonal knowledge — this table must not."""
    banned = (
        "superlab",
        "season 5",
        "ricin",
        "train heist",
        "already met gus",
    )
    for row in PAIR_ROWS:
        blob = f"{row.who} {row.address} {row.familiarity}".lower()
        for token in banned:
            assert token not in blob, f"{row.speaker}->{row.other} encodes {token!r}"


def test_detect_mentions_english_and_chinese():
    ids = detect_mentioned_ids("What if Hank finds out about Saul?")
    assert "hank" in ids
    assert "saul" in ids
    ids_zh = detect_mentioned_ids("玛丽，索尔是谁？汉克呢？")
    assert "marie" in ids_zh
    assert "saul" in ids_zh
    assert "hank" in ids_zh


def test_collect_others_from_present_and_mentions():
    """Given Hank is named and Walt is in the room, Jesse's subset includes both."""
    others = collect_other_ids(
        "jesse",
        present_ids=["Walter White"],
        mention_text="汉克要是知道了怎么办？",
    )
    assert "walter" in others
    assert "hank" in others
    assert "jesse" not in others


def test_format_block_includes_only_relevant_rows():
    block = format_cast_relations_block("jesse", ["hank", "walter"])
    assert "CAST RELATIONS" in block
    assert "Mr. White" in block
    assert "Hank" in block
    assert "DEA" in block or "dea" in block.lower()
    assert "brother-in-law" in block.lower() or "in-law" in block.lower()
    assert "Gus" not in block
    assert "do not invent" in block.lower()


def test_format_empty_when_nobody_else():
    assert format_cast_relations_block("jesse", []) == ""


def test_crew_scope_says_player_belongs_only_to_primary():
    note = crew_player_scope_note("Walter White", "family member")
    assert "only" in note.lower()
    assert "family member" in note
    assert "Walter White" in note
    assert "CAST RELATIONS" in note
    assert "do not invent" in note.lower()


def test_flag_jesse_invented_kinship_and_household():
    """The MiniMax-M3 failures from issue #81 must be caught."""
    mooch = (
        "汉克？沃尔特，你听到没——就汉克那个死条子，整天在我们家蹭饭的那个。"
        "他要是知道了，第一个被铐走的是沃尔特。"
    )
    flags = flag_relation_errors("jesse", mooch)
    assert "invented_kinship" in flags or "wrong_household" in flags
    assert "wrong_address" in flags  # vocative 沃尔特

    flags2 = flag_relation_errors("jesse", "Hank is my brother-in-law.")
    assert "invented_kinship" in flags2


def test_flag_marie_invented_saul_kinship():
    flags = flag_relation_errors("marie", "索尔是我老公，我们家的人。")
    assert "invented_kinship" in flags


def test_clean_jesse_reply_does_not_flag():
    flags = flag_relation_errors(
        "jesse",
        "怀特先生，汉克要是知道了，他会把我们都铐走。那条子又不是我亲戚。",
    )
    assert flags == []


def test_relationship_qa_eval_covers_issue_prompts():
    from eval.relationship_qa import SCENARIOS, _score_logs

    ids = {s["id"] for s in SCENARIOS}
    assert "jesse_hank_finds_out" in ids
    assert "marie_who_is_saul" in ids
    scored = _score_logs(
        "jesse",
        [{"sender": "jesse", "text": "Hank is my brother-in-law."}],
    )
    assert scored["pass"] is False
    assert "invented_kinship" in scored["flags"]
