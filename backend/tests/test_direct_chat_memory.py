"""Direct chat lean stack: labeled history + short dossier (not memory essay dumps)."""

from __future__ import annotations

import json
import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from unittest.mock import AsyncMock, MagicMock

from agents.director import DirectorAgent


def _ok_reply() -> str:
    return json.dumps({
        "reply_text": "I remember.",
        "emotion_state": "tense",
        "gif_search_query": None,
        "thinking": None,
        "tool_executed": None,
        "tool_log": None,
    })


def _director() -> tuple[DirectorAgent, list]:
    captured: list = []

    async def _call(messages, *args, **kwargs):
        captured.append(messages)
        return _ok_reply()

    provider = MagicMock()
    provider.call_model = AsyncMock(side_effect=_call)
    provider.call_model_with_tools = AsyncMock(side_effect=AssertionError("Direct lean must not use tools"))
    provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")
    return DirectorAgent(provider=provider), captured


async def test_direct_chat_uses_labeled_history_and_lean_dossier():
    director, captured = _director()
    recent = [
        {"sender": "user", "text": "yesterday someone robbed me"},
        {"sender": "walter", "text": "Where."},
        {"sender": "user", "text": "outside"},
    ]

    await director.handle_chat_message(
        character_id="walter",
        user_message="So what do we do?",
        context={
            "mode": "direct",
            "relation": "former student",
            "language": "en",
            "history": recent,
            "durableMemory": "Relationship memory:\n- [open_thread] yesterday someone robbed me",
            "llmProvider": "stepfun",
        },
    )

    assert len(captured) == 1
    messages = captured[0]
    blob = json.dumps(messages, ensure_ascii=False)
    # Labeled speakers in history
    assert "Player (former student):" in blob
    assert "Walter:" not in blob or "You are Walter" in blob
    # Assistant history stays unlabeled plain speech
    assert any(
        m.get("role") == "assistant" and m.get("content") == "Where."
        for m in messages
    )
    # Lean dossier — identity + want, not craft essay / full bible
    assert "NOT you" in blob
    assert "This turn you want" in blob
    assert "yesterday someone robbed me" in blob  # open thread in dossier
    assert "Never use bullet lists" not in blob
    assert "DIRECT CHAT CRAFT" not in blob
    # Latest ask is clean
    assert messages[-1]["role"] == "user"
    assert messages[-1]["content"] == "So what do we do?"
    # Lean schema asks for null gif
    assert "gif_search_query" in blob
    assert "must be null" in blob
