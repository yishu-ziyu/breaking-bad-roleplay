"""Direct chat: zh UI + Chinese input must stay Chinese; no gun-meme GIF query."""

from __future__ import annotations

import json
import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from unittest.mock import AsyncMock

from agents.director import sanitize_direct_gif_query


class TestDirectChatLanguage:
    async def test_zh_ui_injects_chinese_lock_and_rewrites_english_reply(
        self, director, mock_provider
    ):
        reply = json.dumps({
            "reply_text": "Yo, if this is another lecture, I need five seconds.",
            "emotion_state": "tense",
            "gif_search_query": "jesse pointing gun",
            "thinking": "He is grilling me again.",
            "tool_executed": None,
            "tool_log": None,
        })
        mock_provider.call_model = AsyncMock(side_effect=[reply, "你再训我？给我五秒钟先缓一下。"])

        context = {
            "mode": "direct",
            "history": [],
            "language": "zh",
            "relation": "partner",
            "llmProvider": "minimax",
        }
        result = await director._handle_direct_chat(
            "jesse",
            "杰西，外面那束车灯是谁？你刚才为什么跑？",
            context,
        )

        messages = mock_provider.call_model.call_args_list[0].args[0]
        assert "Reply in Simplified Chinese only." in messages[0]["content"]
        assert messages[-1]["content"] == "杰西，外面那束车灯是谁？你刚才为什么跑？"
        mock_provider.call_model_with_tools.assert_not_called()
        assert "lecture" not in result["reply_text"].lower()
        assert any("\u4e00" <= ch <= "\u9fff" for ch in result["reply_text"])

    async def test_direct_chat_strips_gun_meme_gif_query(self, director, mock_provider):
        mock_provider.call_model.return_value = json.dumps({
            "reply_text": "别拿枪指我。",
            "emotion_state": "tense",
            "gif_search_query": "jesse pointing gun",
            "thinking": "太近了。",
            "tool_executed": None,
            "tool_log": None,
        })
        result = await director._handle_direct_chat(
            "jesse",
            "你现在把我当成谁？",
            {"mode": "direct", "history": [], "language": "zh", "relation": "partner"},
        )
        query = result["gif_search_query"] or ""
        assert "gun" not in query.lower()
        assert "pistol" not in query.lower()


def test_sanitize_direct_gif_query_maps_gun_to_tense():
    assert sanitize_direct_gif_query("jesse pointing gun") == "tense"
    assert sanitize_direct_gif_query("tense stare") == "tense stare"
