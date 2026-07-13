"""TDD tests: Story mode language enforcement in character prompts."""

from __future__ import annotations

import json

from unittest.mock import AsyncMock

from agents.provider import ModelResult
from agents.director import (
    _latin_letter_ratio,
    _needs_zh_rewrite,
    _norm_lang,
    _status_message,
)


def _mr(text: str) -> ModelResult:
    return ModelResult(content=text, tool_calls=[], stop_reason="end_turn")


def test_norm_lang_accepts_zh_prefix():
    assert _norm_lang("zh") == "zh"
    assert _norm_lang("zh-CN") == "zh"
    assert _norm_lang("en") == "en"
    assert _norm_lang(None) == "en"


def test_latin_ratio_detects_english_leak():
    assert _latin_letter_ratio("He is terrified.") > 0.9
    assert _latin_letter_ratio("他在害怕。") < 0.1
    assert _needs_zh_rewrite("leans back slightly")
    assert not _needs_zh_rewrite("微微靠向椅背")


def test_complete_status_is_localized():
    assert "收束" in _status_message("complete", "zh")
    assert "complete" in _status_message("complete", "en").lower()


# ===================================================================
# Test: Story mode language directive flows to character sub-agents
# ===================================================================

class TestStoryModeLanguageInjection:

    async def test_character_agent_zh_directive(
        self,
        director,
        mock_provider,
    ):
        """_generate_beat with language='zh' injects 简体中文 directive
        into the character sub-agent prompt."""
        mock_provider.call_model = AsyncMock(
            return_value=json.dumps([
                {
                    "type": "agent_speak",
                    "data": {
                        "character_id": "Walter White",
                        "content": "Sit down.",
                        "emotion_state": "tense",
                        "gif_search_query": "walter white tense",
                    },
                },
            ])
        )
        mock_provider.call_model_with_tools = AsyncMock(
            return_value=_mr(json.dumps({
                "reply_text": "Sit down. We need to be precise.",
                "emotion_state": "tense",
                "gif_search_query": "walter white tense",
                "thinking": "He needs control.",
                "tool_executed": None,
                "tool_log": None,
            }))
        )

        async for _ in director._generate_beat(
            task="cook meth",
            outline="1. RV\n2. Lab",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "RV"},
            scene_desc="RV in the desert",
            language="zh",
        ):
            pass

        calls = mock_provider.call_model_with_tools.call_args_list
        assert len(calls) >= 1, "Character sub-agent should be called"

        user_msg = calls[0].args[0][-1]["content"]
        assert "简体中文" in user_msg, (
            f"Character prompt missing 简体中文 directive. Got: {user_msg[:200]}"
        )

    async def test_character_agent_en_directive(
        self,
        director,
        mock_provider,
    ):
        """_generate_beat with language='en' injects English directive."""
        mock_provider.call_model = AsyncMock(
            return_value=json.dumps([
                {
                    "type": "agent_speak",
                    "data": {
                        "character_id": "Walter White",
                        "content": "Sit down.",
                        "emotion_state": "tense",
                        "gif_search_query": "walter white tense",
                    },
                },
            ])
        )
        mock_provider.call_model_with_tools = AsyncMock(
            return_value=_mr(json.dumps({
                "reply_text": "Sit down.",
                "emotion_state": "tense",
                "gif_search_query": "walter white tense",
                "thinking": "He needs control.",
                "tool_executed": None,
                "tool_log": None,
            }))
        )

        async for _ in director._generate_beat(
            task="cook meth",
            outline="1. RV\n2. Lab",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "RV"},
            scene_desc="RV in the desert",
            language="en",
        ):
            pass

        calls = mock_provider.call_model_with_tools.call_args_list
        assert len(calls) >= 1

        user_msg = calls[0].args[0][-1]["content"]
        assert "English" in user_msg, (
            f"Character prompt missing English directive. Got: {user_msg[:200]}"
        )

    async def test_outline_prompt_contains_language_directive(
        self,
        director,
        mock_provider,
    ):
        """_generate_outline user prompt starts with language directive."""
        mock_provider.call_model = AsyncMock(
            return_value="1. RV — Walt and Jesse cook\n2. Lab — They cook more"
        )

        await director._generate_outline("cook meth", language="zh")

        call_args = mock_provider.call_model.call_args
        user_prompt = call_args.args[0][-1]["content"]
        assert "简体中文" in user_prompt, (
            f"Outline prompt missing 简体中文 directive. Got: {user_prompt[:200]}"
        )

    async def test_beat_prompt_contains_language_directive(
        self,
        director,
        mock_provider,
    ):
        """Director beat planning prompt must carry RESPONSE LANGUAGE so
        agent_think / agent_act are not drafted in the wrong language."""
        mock_provider.call_model = AsyncMock(
            return_value=json.dumps([
                {
                    "type": "agent_think",
                    "data": {
                        "character_id": "Gus Fring",
                        "thought_content": "他在害怕。",
                    },
                },
                {
                    "type": "agent_act",
                    "data": {
                        "character_id": "Gus Fring",
                        "action": "微微靠向椅背",
                        "target": None,
                    },
                },
            ])
        )

        async for _ in director._generate_beat(
            task="对峙",
            outline="1. 洛斯波罗斯\n2. 停车场",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "洛斯波罗斯"},
            scene_desc="洛斯波罗斯餐厅办公室",
            language="zh",
        ):
            pass

        call_args = mock_provider.call_model.call_args
        user_prompt = call_args.args[0][-1]["content"]
        assert "简体中文" in user_prompt, (
            f"Beat prompt missing 简体中文 directive. Got: {user_prompt[:300]}"
        )
        assert "agent_think" in user_prompt or "thought_content" in user_prompt or "RESPONSE LANGUAGE" in user_prompt
        assert "leans back" not in user_prompt or "禁止英文" in user_prompt

    async def test_rewrite_english_fields_to_zh_batch(
        self,
        director,
        mock_provider,
    ):
        """English think/act under zh UI are rewritten before yield."""
        mock_provider.call_model = AsyncMock(
            side_effect=[
                # 1) beat plan (English leak)
                json.dumps([
                    {
                        "type": "agent_think",
                        "data": {
                            "character_id": "Gus Fring",
                            "thought_content": "He is terrified. Good.",
                        },
                    },
                    {
                        "type": "agent_act",
                        "data": {
                            "character_id": "Gus Fring",
                            "action": "leans back slightly",
                            "target": None,
                        },
                    },
                ]),
                # 2) batch zh rewrite
                json.dumps([
                    {"id": 0, "text": "他很害怕。很好。"},
                    {"id": 1, "text": "微微靠向椅背"},
                ]),
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
        acts = [e for e in collected if e.type == "agent_act"]
        assert thinks, "expected agent_think event"
        assert acts, "expected agent_act event"
        assert "害怕" in (thinks[0].data.get("thought_content") or "")
        assert "靠" in (acts[0].data.get("action") or "") or "椅" in (acts[0].data.get("action") or "")
        assert "leans" not in (acts[0].data.get("action") or "").lower()
