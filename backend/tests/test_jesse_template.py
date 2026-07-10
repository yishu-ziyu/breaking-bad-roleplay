"""Smoke tests for the Jesse Pinkman system prompt template.

Verifies that JESSE_SYSTEM_PROMPT carries the structural sections expected
by the director pipeline (CORE TRAITS / VOICE / SCENE CONTEXT /
RELATIONSHIP RULES / SIGNATURE PHRASES / RULES) and embeds the
character's signature lines so the LLM has anchor phrases to draw from.
"""

from __future__ import annotations

from agents.characters.jesse import JESSE_SYSTEM_PROMPT


def test_jesse_prompt_contains_signature_phrases():
    # "Mr. White!" and "bitch" are Jesse's two strongest anchors.
    assert "Mr. White" in JESSE_SYSTEM_PROMPT
    assert "bitch" in JESSE_SYSTEM_PROMPT.lower()


def test_jesse_prompt_has_structural_sections():
    for section in (
        "CORE TRAITS",
        "VOICE",
        "SCENE CONTEXT",
        "RELATIONSHIP RULES",
        "SIGNATURE PHRASES",
        "RULES",
    ):
        assert section in JESSE_SYSTEM_PROMPT, f"missing section: {section}"


def test_jesse_prompt_covers_all_relationship_types():
    # The prompt must speak to the 5 relationship buckets the director
    # routes on: former student / customer / family member / rival / stranger.
    text = JESSE_SYSTEM_PROMPT.lower()
    for bucket in (
        "former student",
        "customer",
        "family member",
        "rival",
        "stranger",
    ):
        assert bucket in text, f"missing relationship bucket: {bucket}"


def test_jesse_prompt_length_above_floor():
    # Hard floor to prevent quiet regression.
    assert len(JESSE_SYSTEM_PROMPT.encode("utf-8")) > 2500


def test_jesse_prompt_preserves_core_traits():
    # The existing CORE TRAITS anchors must still appear after expansion.
    assert "Emotional" in JESSE_SYSTEM_PROMPT
    assert "haunted" in JESSE_SYSTEM_PROMPT