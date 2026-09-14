"""Direct chat: opening pin + digest still reach the model after the recent window."""

from __future__ import annotations

import json
import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from unittest.mock import AsyncMock, MagicMock

from agents.director import DirectorAgent
from agents.provider import ModelResult


def _ok_reply() -> str:
    return json.dumps({
        "reply_text": "I remember.",
        "emotion_state": "tense",
        "gif_search_query": "walter white tense",
        "thinking": "He brought up the laundry again.",
        "tool_executed": None,
        "tool_log": None,
    })


def _director() -> tuple[DirectorAgent, list]:
    captured: list = []

    async def _tools(messages, *args, **kwargs):
        captured.append(messages)
        return ModelResult(content=_ok_reply(), tool_calls=[], stop_reason="end_turn")

    provider = MagicMock()
    provider.call_model = AsyncMock(return_value=_ok_reply())
    provider.call_model_with_tools = AsyncMock(side_effect=_tools)
    provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")
    return DirectorAgent(provider=provider), captured


async def test_direct_chat_injects_opening_and_digest_when_history_is_only_recent():
    director, captured = _director()
    opening_line = "First thing I said: the laundry is a front."
    middle_line = "I promised to keep Skyler out of it."
    recent = [
        {"sender": "user" if i % 2 == 0 else "walter", "text": f"Recent {i}"}
        for i in range(10)
    ]

    await director.handle_chat_message(
        character_id="walter",
        user_message="Do you remember how this started?",
        context={
            "mode": "direct",
            "relation": "former student",
            "language": "en",
            "history": recent,
            "memoryOpening": [
                {"sender": "user", "text": opening_line},
                {"sender": "walter", "text": "Turn 2"},
            ],
            "memoryDigest": f"Player: {middle_line}",
            "llmProvider": "stepfun",
        },
    )

    blob = json.dumps(captured, ensure_ascii=False)
    assert opening_line in blob
    assert middle_line in blob
    assert "This conversation opened with" in blob
    assert "What happened after that" in blob
    # Recent window must not be the only memory; the opening is outside it.
    recent_only = json.dumps(recent, ensure_ascii=False)
    assert opening_line not in recent_only
