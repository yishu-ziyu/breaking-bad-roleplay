"""TDD tests: Story mode language enforcement in character prompts."""

from __future__ import annotations

import json

import pytest
from unittest.mock import AsyncMock, MagicMock

from agents.provider import ModelResult


def _mr(text: str) -> ModelResult:
    return ModelResult(content=text, tool_calls=[], stop_reason="end_turn")


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
