"""Crew turns: one lead, at most one short reaction that hears the lead, texting format."""

from __future__ import annotations

import json
import os
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from agents.director import DirectorAgent  # noqa: E402

pytestmark = pytest.mark.asyncio


def _director(lines: dict[str, str]):
    """Fake provider: answers as whichever character the system prompt names."""
    captured: list[list[dict]] = []

    async def _call(messages, *args, **kwargs):
        captured.append(messages)
        system = messages[0]["content"]
        speaker = next((name for name in lines if f"You are {name}" in system), "Walter White")
        return json.dumps({"reply_text": lines[speaker], "emotion_state": "tense"})

    provider = MagicMock()
    provider.call_model = AsyncMock(side_effect=_call)
    provider.call_model_with_tools = AsyncMock(side_effect=AssertionError("crew chat must not use tools"))
    provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")
    return DirectorAgent(provider=provider, enable_dossier_updates=False), captured


CTX = {"mode": "crew", "relation": "family member", "language": "zh", "history": [], "llmProvider": "stepfun"}


async def test_nobody_with_a_reason_means_one_reply():
    director, captured = _director({"Skyler White": "说重点。", "Gus Fring": "请讲。"})
    out = await director.handle_chat_message("skyler", "在吗？", dict(CTX))
    assert [log["sender"] for log in out["debate_logs"]] == ["skyler"]
    assert len(captured) == 1


async def test_named_second_person_reacts_to_the_lead_in_one_short_line():
    director, captured = _director({
        "Jesse Pinkman": "我昨晚在家。",
        "Hank Schrader": "……在家？行。",
        "Walter White": "不关我事。",
    })
    out = await director.handle_chat_message("walter", "杰西、汉克，你们昨晚在哪？", dict(CTX))
    assert [log["sender"] for log in out["debate_logs"]] == ["jesse", "hank"]
    reactor_turn = json.dumps(captured[1], ensure_ascii=False)
    assert "我昨晚在家。" in reactor_turn, "the reactor must hear what the lead just said"
    assert "one short line" in reactor_turn


async def test_never_more_than_two_speakers():
    director, _ = _director({
        "Walter White": "说。", "Jesse Pinkman": "啥？", "Hank Schrader": "嗯？", "Saul Goodman": "好问题。",
    })
    out = await director.handle_chat_message("walter", "杰西、汉克、索尔，你们都说说。", dict(CTX))
    assert len(out["debate_logs"]) <= 2


async def test_crew_uses_the_text_message_format():
    director, captured = _director({"Walter White": "说。"})
    await director.handle_chat_message("walter", "在吗？", dict(CTX))
    system = captured[0][0]["content"]
    assert "text message" in system.lower()
    assert "group" in system.lower()


async def test_a_reply_never_carries_someone_elses_line():
    director, _ = _director({"Jesse Pinkman": "jesse: 没人跟你吵。\n\nwalter: 你把话说完。", "Walter White": "说。"})
    out = await director.handle_chat_message("walter", "杰西，你说呢？", dict(CTX))
    jesse = next(log for log in out["debate_logs"] if log["sender"] == "jesse")
    assert jesse["text"] == "没人跟你吵。"


async def test_everyone_in_the_group_knows_who_the_player_is():
    director, captured = _director({"Jesse Pinkman": "啥？", "Walter White": "说。"})
    await director.handle_chat_message("walter", "杰西，你说呢？", dict(CTX))
    system = captured[0][0]["content"]
    assert "You are Jesse Pinkman" in system
    assert "The player is Walter White's family member" in system
