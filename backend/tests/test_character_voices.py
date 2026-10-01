"""Eight distinct conversation behaviors, one length rule, and a texting frame for Direct.

See docs/research/2026-10-01-chat-feel-round2-chatgpt.md: the main risk for
known characters is that they all melt into the same polite assistant.
"""

import pytest

from agents.character_policy import _CORE_PROMPTS
from agents.direct_chat_stack import DIRECT_LEAN_OUTPUT_PROMPT, build_direct_dossier

CAST = ["walter", "jesse", "skyler", "saul", "mike", "gus", "hank", "marie"]


@pytest.mark.parametrize("actor", CAST)
def test_every_character_has_its_own_conversation_behavior(actor):
    prompt = _CORE_PROMPTS[actor]
    assert "CONVERSATION BEHAVIOR" in prompt
    block = prompt.split("CONVERSATION BEHAVIOR", 1)[1].split("SAFETY / RULES", 1)[0]
    for facet in ("Length:", "Answering:", "Under pressure:"):
        assert facet in block, f"{actor} behavior card is missing {facet}"


def test_conversation_behaviors_are_all_different():
    blocks = {
        actor: _CORE_PROMPTS[actor].split("CONVERSATION BEHAVIOR", 1)[1].split("SAFETY / RULES", 1)[0]
        for actor in CAST
    }
    assert len(set(blocks.values())) == len(CAST)


@pytest.mark.parametrize("actor", CAST)
def test_no_shared_sentence_count_overrides_the_character(actor):
    assert "2-6 sentences" not in _CORE_PROMPTS[actor]


def test_direct_output_is_a_text_message_and_defers_length_to_the_character():
    assert "1-2 short sentences" not in DIRECT_LEAN_OUTPUT_PROMPT
    assert "CONVERSATION BEHAVIOR" in DIRECT_LEAN_OUTPUT_PROMPT
    assert "text message" in DIRECT_LEAN_OUTPUT_PROMPT.lower()


def test_direct_dossier_does_not_force_every_character_to_answer():
    dossier = build_direct_dossier("gus", relation="employee", language="zh")
    assert "answer their latest line, then move" not in dossier
    assert "dodge" in dossier
