"""Independent chats cannot inherit a Story session through shared plumbing."""
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.director import DirectorAgent


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["direct", "crew"])
async def test_chat_entry_discards_story_state_and_database_handle(mode):
    director = DirectorAgent(MagicMock())
    handler = AsyncMock(return_value={"reply_text": "Hello"})
    setattr(director, f"_handle_{mode}_chat", handler)
    db = MagicMock()
    await director.handle_chat_message("saul", "Hello", {
        "mode": mode, "relation": "client", "language": "en",
        "history": [{"sender": "user", "text": "Our conversation"}],
        "sessionId": "private-story", "session_id": "private-story",
        "world_state": {"secret": "STORY_SECRET"}, "expected_revision": 9,
        "durableMemory": "- [secret] DIRECT_SECRET",
    }, session_factory=db)
    context = handler.await_args.args[2]
    assert "sessionId" not in context
    assert "session_id" not in context
    assert "world_state" not in context
    assert "expected_revision" not in context
    assert context["relation"] == "client"
    assert context["history"][0]["text"] == "Our conversation"
    assert handler.await_args.args[3] is None
    if mode == "crew":
        assert not context.get("durableMemory")
    else:
        assert "DIRECT_SECRET" in context["durableMemory"]
