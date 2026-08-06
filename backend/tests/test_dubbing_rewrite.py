"""TDD tests for the lightweight "译制腔" rewrite guard.

The guard (``agents.dubbing_rewrite.rewrite_dubbing_in_events``) is the
detect→rewrite chain that sits on top of the probe
(``agents.dubbing_guard_probe.detect_dubbing_tone``). It only fires an LLM
rewrite when the detector verdict is exactly ``dubbing`` — clean / suspicious
must not cause an extra LLM call (cheap-first principle).
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.dubbing_rewrite import rewrite_dubbing_in_events

# A text that the probe scores as dubbing (一想到 +2, 内心深处 +1).
DUBBING_TEXT = "一想到你，我就觉得内心深处的恐惧。"
# A normal Chinese line the probe scores clean.
CLEAN_TEXT = "我饿了，今天想早点回家。"


def _speak_event(content: str) -> list[dict]:
    return [
        {
            "type": "agent_speak",
            "data": {"character_id": "Walter White", "content": content},
        }
    ]


def _rewarded_provider(rewritten: str = "我早就不怕了。") -> MagicMock:
    provider = MagicMock()
    provider.call_model = AsyncMock(
        return_value=json.dumps([{"id": 0, "text": rewritten}], ensure_ascii=False)
    )
    return provider


class TestTriggerCondition:
    async def test_clean_does_not_trigger_rewrite(self):
        provider = _rewarded_provider()
        events = _speak_event(CLEAN_TEXT)
        out = await rewrite_dubbing_in_events(
            events, provider, "stepfun/step-3.7-flash", language="zh"
        )
        assert out[0]["data"]["content"] == CLEAN_TEXT
        provider.call_model.assert_not_awaited()

    async def test_dubbing_triggers_rewrite(self):
        provider = _rewarded_provider()
        events = _speak_event(DUBBING_TEXT)
        out = await rewrite_dubbing_in_events(
            events, provider, "stepfun/step-3.7-flash", language="zh"
        )
        provider.call_model.assert_awaited_once()
        assert "早就不怕" in out[0]["data"]["content"]

    async def test_english_locale_does_not_trigger(self):
        provider = _rewarded_provider()
        events = _speak_event(DUBBING_TEXT)
        out = await rewrite_dubbing_in_events(
            events, provider, "stepfun/step-3.7-flash", language="en"
        )
        assert out[0]["data"]["content"] == DUBBING_TEXT
        provider.call_model.assert_not_awaited()


class TestRewriteEffect:
    async def test_rewrite_replaces_content(self):
        provider = _rewarded_provider(rewritten="我早就没有感觉了。")
        events = _speak_event(DUBBING_TEXT)
        out = await rewrite_dubbing_in_events(
            events, provider, "stepfun/step-3.7-flash", language="zh"
        )
        assert out[0]["data"]["content"] == "我早就没有感觉了。"

    async def test_rewrite_inner_monologue_too(self):
        provider = _rewarded_provider(rewritten="她知道了。")
        events = [
            {
                "type": "agent_think",
                "data": {"character_id": "Skyler White", "thought_content": DUBBING_TEXT},
            }
        ]
        out = await rewrite_dubbing_in_events(
            events, provider, "stepfun/step-3.7-flash", language="zh"
        )
        assert out[0]["data"]["thought_content"] == "她知道了。"


class TestWiringIntoDirector:
    async def test_generate_beat_rewrites_dubbing_think_before_yield(
        self, director, mock_provider
    ):
        """The guard is wired into _generate_beat's Phase 2: a dubbing
        inner monologue is rewritten, and the rewritten text is yielded."""
        mock_provider.call_model = AsyncMock(
            side_effect=[
                json.dumps([
                    {
                        "type": "agent_think",
                        "data": {
                            "character_id": "Gus Fring",
                            "thought_content": DUBBING_TEXT,
                        },
                    }
                ]),
                json.dumps([{"id": 0, "text": "我早就没有感觉了。"}]),
            ]
        )
        collected = []
        async for evt in director._generate_beat(
            task="对峙",
            outline="1. 办公室\n2. 停车场",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "办公室"},
            scene_desc="办公室",
            language="zh",
        ):
            collected.append(evt)

        thinks = [e for e in collected if e.type == "agent_think"]
        assert thinks, "expected an agent_think event"
        thought = thinks[0].data.get("thought_content") or ""
        assert "感觉" in thought, f"dubbing think not rewritten: {thought!r}"
        assert "一想到" not in thought


class TestDegradation:
    async def test_rewrite_failure_degrades_to_original(self):
        provider = MagicMock()
        provider.call_model = AsyncMock(side_effect=RuntimeError("provider down"))
        events = _speak_event(DUBBING_TEXT)
        out = await rewrite_dubbing_in_events(
            events, provider, "stepfun/step-3.7-flash", language="zh"
        )
        # Guard must never crash the conversation; keep the original text.
        assert out[0]["data"]["content"] == DUBBING_TEXT

    async def test_unparseable_rewrite_degrades_to_original(self):
        provider = MagicMock()
        provider.call_model = AsyncMock(return_value="not json at all")
        events = _speak_event(DUBBING_TEXT)
        out = await rewrite_dubbing_in_events(
            events, provider, "stepfun/step-3.7-flash", language="zh"
        )
        assert out[0]["data"]["content"] == DUBBING_TEXT