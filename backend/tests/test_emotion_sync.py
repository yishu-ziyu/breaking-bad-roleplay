"""Cycle 37 (Additional #2) tests: emotion_state / gif_search_query
must stay in sync with the final message content when a character
sub-agent rewrites the dialogue.

Before the fix, ``_generate_beat`` called ``provider.call_model`` for
the character sub-agent and only spliced the new ``content`` into
``evt_data`` — ``emotion_state`` and ``gif_search_query`` were left
stale from the Director's original planning pass.

The fix routes the sub-agent call through
``BaseCharacter.respond_structured`` so the same LLM response yields
``reply_text`` + ``emotion_state`` + ``gif_search_query`` together.
If the sub-agent response lacks structured metadata (plain text), the
Director-provided values are kept as a defensive fallback.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

from models.schemas import AgentEvent


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _beat_events_json(emotion: str, gif: str) -> str:
    """Director planning response: a single agent_speak event whose
    emotion/gif are intentionally DIFFERENT from what the sub-agent
    will return, so a stale-field bug is detectable."""
    return json.dumps([
        {
            "type": "agent_speak",
            "data": {
                "character_id": "Walter White",
                "content": "DIRECTOR_DRAFT_PLACEHOLDER",
                "emotion_state": emotion,
                "gif_search_query": gif,
            },
            "recommended_model": "stepfun/step-3.7-flash",
        }
    ])


def _structured_sub_agent_reply(
    reply_text: str, emotion: str, gif: str
) -> str:
    """Sub-agent LLM response formatted as the structured JSON envelope
    that ``respond_structured`` + ``STRUCTURED_OUTPUT_PROMPT`` elicits."""
    return json.dumps({
        "reply_text": reply_text,
        "emotion_state": emotion,
        "gif_search_query": gif,
        "thinking": "inner monologue",
        "tool_executed": None,
        "tool_log": None,
    })


async def _run_beat(director, mock_provider, mock_db):
    """Drive ``_generate_beat`` to completion with dossiers stubbed out."""
    events: list[AgentEvent] = []
    with patch(
        "agents.director.update_dossiers",
        new=AsyncMock(return_value=None),
    ):
        async for ev in director._generate_beat(
            task="t",
            outline="1. RV — cook",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "RV"},
            db=mock_db,
            session_id="sess-cycle37",
        ):
            events.append(ev)
    return events


def _added_messages(mock_db):
    from db.models import Message
    return [
        call.args[0] for call in mock_db.add.call_args_list
        if isinstance(call.args[0], Message)
    ]


# ===================================================================
# Cycle 37: emotion/gif sync with content replace
# ===================================================================

class TestCycle37_EmotionSync:
    """Scenario: character sub-agent rewrites content; emotion_state and
    gif_search_query must reflect the NEW content, not the Director's
    original draft."""

    async def test_emotion_sync_with_content_replace(
        self, director, mock_provider, mock_db
    ):
        """Given the Director plans emotion=calm but the sub-agent
        returns an angry rewrite, the persisted Message and the yielded
        agent_speak event both carry emotion=angry and the new
        gif_search_query — not the stale Director values."""
        mock_provider.call_model = AsyncMock(
            side_effect=[
                _beat_events_json("calm", "walter white calm"),
                _structured_sub_agent_reply(
                    "I am the one who knocks!",
                    "angry",
                    "walter white angry determined",
                ),
            ]
        )
        mock_provider.resolve_model_route = MagicMock(
            return_value="stepfun/step-3.7-flash"
        )

        events = await _run_beat(director, mock_provider, mock_db)

        # ---- Persisted Message row ---------------------------------
        msgs = _added_messages(mock_db)
        assert len(msgs) == 1, f"Expected 1 Message, got {len(msgs)}"
        msg = msgs[0]
        assert msg.content == "I am the one who knocks!"
        # The fix: emotion/gif reflect the sub-agent rewrite, NOT the
        # Director's original "calm" / "walter white calm".
        assert msg.emotion_state == "angry", (
            f"emotion_state should sync with rewritten content, got "
            f"{msg.emotion_state!r}"
        )
        assert msg.gif_search_query == "walter white angry determined", (
            f"gif_search_query should sync with rewritten content, got "
            f"{msg.gif_search_query!r}"
        )

        # ---- Yielded SSE event -------------------------------------
        speak = [e for e in events if e.type == "agent_speak"]
        assert len(speak) == 1
        assert speak[0].data["content"] == "I am the one who knocks!"
        assert speak[0].data["emotion_state"] == "angry"
        assert speak[0].data["gif_search_query"] == "walter white angry determined"

    async def test_emotion_sync_normal_path(
        self, director, mock_provider, mock_db
    ):
        """Given a normal sub-agent structured response, emotion_state
        and gif_search_query are set from the sub-agent payload (not
        left as the Director's draft values)."""
        mock_provider.call_model = AsyncMock(
            side_effect=[
                _beat_events_json("tense", "walter white tense"),
                _structured_sub_agent_reply(
                    "We need to cook.",
                    "manipulative",
                    "walter white cold calculating",
                ),
            ]
        )
        mock_provider.resolve_model_route = MagicMock(
            return_value="stepfun/step-3.7-flash"
        )

        events = await _run_beat(director, mock_provider, mock_db)

        msgs = _added_messages(mock_db)
        assert len(msgs) == 1
        msg = msgs[0]
        assert msg.content == "We need to cook."
        assert msg.emotion_state == "manipulative"
        assert msg.gif_search_query == "walter white cold calculating"

        speak = [e for e in events if e.type == "agent_speak"]
        assert len(speak) == 1
        assert speak[0].data["emotion_state"] == "manipulative"
        assert speak[0].data["gif_search_query"] == "walter white cold calculating"

    async def test_emotion_sync_fallback_preserves_director_values(
        self, director, mock_provider, mock_db
    ):
        """Given the sub-agent returns plain text (no JSON envelope),
        ``_extract_structured`` yields None for emotion/gif; the fix
        then falls back to the Director-provided values so the UI is
        not left with nulls. Content still comes from the sub-agent."""
        mock_provider.call_model = AsyncMock(
            side_effect=[
                _beat_events_json("tense", "walter white tense"),
                "Yeah, okay.",  # plain text, no JSON
            ]
        )
        mock_provider.resolve_model_route = MagicMock(
            return_value="stepfun/step-3.7-flash"
        )

        events = await _run_beat(director, mock_provider, mock_db)

        msgs = _added_messages(mock_db)
        assert len(msgs) == 1
        msg = msgs[0]
        # Content is the sub-agent's plain-text reply.
        assert msg.content == "Yeah, okay."
        # emotion/gif fall back to Director values (not None).
        assert msg.emotion_state == "tense", (
            f"Fallback should preserve Director emotion, got "
            f"{msg.emotion_state!r}"
        )
        assert msg.gif_search_query == "walter white tense", (
            f"Fallback should preserve Director gif_query, got "
            f"{msg.gif_search_query!r}"
        )

    async def test_emotion_sync_multiple_speakers(
        self, director, mock_provider, mock_db
    ):
        """Given two agent_speak events with distinct sub-agent
        rewrites, each Message row carries its own synced emotion/gif
        — no cross-contamination between speakers."""
        beat_events = json.dumps([
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Walter White",
                    "content": "WALT_DRAFT",
                    "emotion_state": "calm",
                    "gif_search_query": "walter calm",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Jesse Pinkman",
                    "content": "JESSE_DRAFT",
                    "emotion_state": "calm",
                    "gif_search_query": "jesse calm",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            },
        ])
        mock_provider.call_model = AsyncMock(
            side_effect=[
                beat_events,
                _structured_sub_agent_reply(
                    "I will handle it.", "manipulative", "walter white cold"
                ),
                _structured_sub_agent_reply(
                    "Yeah right, bitch!", "angry", "jesse pinkman angry yelling"
                ),
            ]
        )
        mock_provider.resolve_model_route = MagicMock(
            return_value="stepfun/step-3.7-flash"
        )

        events = await _run_beat(director, mock_provider, mock_db)

        msgs = _added_messages(mock_db)
        assert len(msgs) == 2, f"Expected 2 Messages, got {len(msgs)}"
        # Order matches event order: Walt first, Jesse second.
        walt_msg, jesse_msg = msgs
        assert walt_msg.character_name == "Walter White"
        assert walt_msg.content == "I will handle it."
        assert walt_msg.emotion_state == "manipulative"
        assert walt_msg.gif_search_query == "walter white cold"
        assert jesse_msg.character_name == "Jesse Pinkman"
        assert jesse_msg.content == "Yeah right, bitch!"
        assert jesse_msg.emotion_state == "angry"
        assert jesse_msg.gif_search_query == "jesse pinkman angry yelling"
