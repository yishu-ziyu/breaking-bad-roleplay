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
