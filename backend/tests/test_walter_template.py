"""Smoke tests for the Walter White system prompt template.

Verifies that WALTER_SYSTEM_PROMPT carries the structural sections expected
by the director pipeline (CORE TRAITS / VOICE / SCENE CONTEXT /
RELATIONSHIP RULES / SIGNATURE PHRASES / RULES) and embeds the
character's signature lines so the LLM has anchor phrases to draw from.
"""

from __future__ import annotations

from agents.characters.walter import WALTER_SYSTEM_PROMPT


def test_walter_prompt_contains_signature_phrases():
    # The exact line "I am the danger" must appear verbatim.
    assert "I am the danger" in WALTER_SYSTEM_PROMPT
    # The catchphrase "Say my name." must appear (case-insensitive).
    assert "say my name" in WALTER_SYSTEM_PROMPT.lower()


def test_walter_prompt_has_structural_sections():
    for section in (
        "CORE TRAITS",
        "VOICE",
        "SCENE CONTEXT",
        "RELATIONSHIP RULES",
        "SIGNATURE PHRASES",
        "RULES",
    ):
        assert section in WALTER_SYSTEM_PROMPT, f"missing section: {section}"


def test_walter_prompt_covers_all_relationship_types():
    # The prompt must speak to the 5 relationship buckets the director
    # routes on: former student / client / family member / rival / stranger.
    text = WALTER_SYSTEM_PROMPT.lower()
    for bucket in (
        "former student",
        "client",
        "family member",
        "rival",
        "stranger",
    ):
        assert bucket in text, f"missing relationship bucket: {bucket}"


def test_walter_prompt_length_above_floor():
    # The brief was ~3000 bytes; we assert a hard floor so the prompt
    # cannot quietly regress below 2500.
    assert len(WALTER_SYSTEM_PROMPT.encode("utf-8")) > 2500


def test_walter_prompt_preserves_core_traits():
    # The existing CORE TRAITS anchors must still appear after expansion.
    assert "Brilliant chemist" in WALTER_SYSTEM_PROMPT
    assert "methamphetamine" in WALTER_SYSTEM_PROMPT