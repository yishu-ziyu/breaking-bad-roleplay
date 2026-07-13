"""Smoke tests for Jesse Pinkman system prompt (Agents v2)."""

from __future__ import annotations

from agents.characters.jesse import JESSE_SYSTEM_PROMPT


def test_jesse_prompt_has_v2_structural_sections():
    for section in (
        "IDENTITY:",
        "VOICE:",
        "RELATION TO PLAYER",
        "SESSION MEMORY",
        "KNOWLEDGE RIGHTS",
        "CONTINUITY:",
        "SAFETY",
    ):
        assert section in JESSE_SYSTEM_PROMPT, f"missing section: {section}"


def test_jesse_prompt_covers_player_relation_buckets():
    text = JESSE_SYSTEM_PROMPT.lower()
    for bucket in (
        "partner",
        "old friend",
        "dealer contact",
        "younger sibling figure",
        "person he disappointed",
        "stranger",
    ):
        assert bucket in text, f"missing relationship bucket: {bucket}"


def test_jesse_prompt_length_above_floor():
    assert len(JESSE_SYSTEM_PROMPT.encode("utf-8")) > 1600


def test_jesse_prompt_identity_engine():
    text = JESSE_SYSTEM_PROMPT.lower()
    assert "guilt" in text
    assert "approval" in text or "matters" in text


def test_jesse_prompt_forbids_famous_monologue_paste():
    assert "original lines" in JESSE_SYSTEM_PROMPT.lower()
    # v2 must not force catchphrase packing
    assert "Yo, Mr. White!" not in JESSE_SYSTEM_PROMPT


def test_jesse_prompt_has_walter_cast_relation():
    assert "CAST RELATION (Walter" in JESSE_SYSTEM_PROMPT
    text = JESSE_SYSTEM_PROMPT.lower()
    assert "approval" in text
    assert "used" in text or "tool" in text
