"""Crew cast selection from user message mentions."""

import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from agents.director import crew_participants_from_message


def test_primary_always_first():
    parts = crew_participants_from_message("walter", "hello")
    assert parts[0] == "Walter White"
    assert len(parts) == 1


def test_hank_and_schrader_positive():
    assert "Hank Schrader" in crew_participants_from_message("walter", "call hank over")
    assert "Hank Schrader" in crew_participants_from_message("walter", "ask Schrader")


def test_deal_already_do_not_pull_hank():
    parts = crew_participants_from_message("walter", "we already have a deal deadline")
    assert "Hank Schrader" not in parts


def test_bare_dea_does_not_pull_hank():
    parts = crew_participants_from_message("jesse", "avoid the DEA office heat")
    assert "Hank Schrader" not in parts


def test_cap_three():
    parts = crew_participants_from_message(
        "walter", "bring jesse saul mike gus hank"
    )
    assert len(parts) == 3
    assert parts[0] == "Walter White"


def test_chinese_names_pull_walter_and_jesse():
    parts = crew_participants_from_message(
        "jesse", "沃尔特，杰西刚才说的是真的吗？你们两个谁在撒谎？"
    )
    assert parts[0] == "Jesse Pinkman"
    assert "Walter White" in parts


def test_chinese_aliases_pull_each_speaker():
    cases = (
        ("jesse", "沃尔特你说话", "Walter White"),
        ("walter", "杰西刚才说的是真的吗", "Jesse Pinkman"),
        ("walter", "古斯还在听吗", "Gus Fring"),
        ("walter", "迈克怎么看", "Mike Ehrmantraut"),
        ("walter", "索尔你接得住吗", "Saul Goodman"),
        ("walter", "斯凯勒知道多少", "Skyler White"),
        ("walter", "汉克要是打电话过来", "Hank Schrader"),
    )
    for primary, message, expected in cases:
        parts = crew_participants_from_message(primary, message)
        assert expected in parts, f"{message!r} did not pull {expected}: {parts}"
