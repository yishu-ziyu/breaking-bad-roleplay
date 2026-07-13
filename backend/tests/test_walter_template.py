"""Smoke tests for Walter White system prompt (Agents v2).

v2 drops monologue packing and uses IDENTITY / VOICE / RELATION /
SESSION MEMORY / KNOWLEDGE RIGHTS / CONTINUITY / SAFETY.
"""

from __future__ import annotations

from agents.characters.walter import WALTER_SYSTEM_PROMPT


def test_walter_prompt_has_v2_structural_sections():
    for section in (
        "IDENTITY:",
        "VOICE:",
        "RELATION TO PLAYER",
        "SESSION MEMORY",
        "KNOWLEDGE RIGHTS",
        "CONTINUITY:",
        "SAFETY",
    ):
        assert section in WALTER_SYSTEM_PROMPT, f"missing section: {section}"


def test_walter_prompt_covers_player_relation_buckets():
    text = WALTER_SYSTEM_PROMPT.lower()
    for bucket in (
        "former student",
        "family member",
        "lab partner",
        "dea liability",
        "old colleague",
        "stranger",
    ):
        assert bucket in text, f"missing relationship bucket: {bucket}"


def test_walter_prompt_length_above_floor():
    assert len(WALTER_SYSTEM_PROMPT.encode("utf-8")) > 1800


def test_walter_prompt_identity_engine():
    assert "pride" in WALTER_SYSTEM_PROMPT.lower()
    assert "responsibility" in WALTER_SYSTEM_PROMPT.lower()


def test_walter_prompt_forbids_famous_monologue_paste():
    assert "Original lines only" in WALTER_SYSTEM_PROMPT or "original lines" in WALTER_SYSTEM_PROMPT.lower()
    # v2 must not pack signature monologues as free candy
    assert "I am the danger." not in WALTER_SYSTEM_PROMPT


def test_walter_prompt_has_jesse_cast_relation():
    assert "CAST RELATION (Jesse)" in WALTER_SYSTEM_PROMPT
    text = WALTER_SYSTEM_PROMPT.lower()
    assert "control ritual" in text or "approval" in text or "teacher" in text
