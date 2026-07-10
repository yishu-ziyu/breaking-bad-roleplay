from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from api.routes import _session_queues, session_action
from models.schemas import SessionAction
from agents.provider import ModelResult


def _mr(text: str, tool_calls=None) -> ModelResult:
    """Build a ModelResult for a character sub-agent call (native function
    calling path, DEC-0001)."""
    return ModelResult(
        content=text,
        tool_calls=tool_calls or [],
        stop_reason="tool_use" if tool_calls else "end_turn",
    )


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


def _session_row(session_id: str = "sess-123"):
    session = MagicMock()
    session.id = session_id
    session.status = "active"
    session.title = "chapter one"
    session.task_prompt = "Walter needs leverage."
    return session


async def _call_action(mock_db, payload: SessionAction):
    session = _session_row()
    mock_db.execute = AsyncMock(return_value=_ScalarResult(session))
    queue: asyncio.Queue = asyncio.Queue(maxsize=4)
    _session_queues[session.id] = {"queue": queue, "beat_index": 0}
    try:
        response = await session_action(session.id, payload, mock_db)
        signal = queue.get_nowait()
        return response, signal, session
    finally:
        _session_queues.pop(session.id, None)


class TestLoop4SessionActions:
    async def test_continue_chapter_pushes_action_queue_signal(self, mock_db):
        response, signal, session = await _call_action(
            mock_db,
            SessionAction(action="continue_chapter", branch_goal="raise pressure"),
        )

        assert response.status == "ok"
        assert response.session_id == "sess-123"
        assert signal == {
            "action": "continue_chapter",
            "branch_goal": "raise pressure",
        }
        assert session.title == "chapter one (continued)"
        assert mock_db.commit.await_count == 1

    async def test_branch_requires_from_beat_id(self, mock_db):
        session = _session_row()
        mock_db.execute = AsyncMock(return_value=_ScalarResult(session))

        with pytest.raises(HTTPException) as exc_info:
            await session_action(
                session.id,
                SessionAction(action="branch"),
                mock_db,
            )

        assert exc_info.value.status_code == 400
        assert "from_beat_id" in exc_info.value.detail

    async def test_branch_pushes_action_queue_signal(self, mock_db):
        response, signal, _session = await _call_action(
            mock_db,
            SessionAction(
                action="branch",
                from_beat_id="beat_2",
                branch_goal="Skyler finds the lie",
            ),
        )

        assert response.status == "ok"
        assert signal == {
            "action": "branch",
            "from_beat_id": "beat_2",
            "branch_goal": "Skyler finds the lie",
        }

    async def test_replay_requires_beat_id(self, mock_db):
        session = _session_row()
        mock_db.execute = AsyncMock(return_value=_ScalarResult(session))

        with pytest.raises(HTTPException) as exc_info:
            await session_action(
                session.id,
                SessionAction(action="replay"),
                mock_db,
            )

        assert exc_info.value.status_code == 400
        assert "beat_id" in exc_info.value.detail

    async def test_replay_pushes_action_queue_signal(self, mock_db):
        response, signal, _session = await _call_action(
            mock_db,
            SessionAction(action="replay", beat_id="beat_3"),
        )

        assert response.status == "ok"
        assert signal == {"action": "replay", "beat_id": "beat_3"}


class TestLoop4DirectorVoiceAnchor:
    async def test_generate_beat_includes_voice_anchor_in_system_prompt(self, director, mock_provider):
        captured_messages = []

        async def capture(messages, route):
            captured_messages.append(messages)
            return json.dumps([])

        mock_provider.call_model = AsyncMock(side_effect=capture)
        mock_provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")

        async for _ in director._generate_beat(
            task="Walter confronts Gus.",
            outline="1. Los Pollos office - Gus watches Walt.",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "Los Pollos office"},
            voice_example="Do not use feeling. Weigh it, record it, verify it.",
        ):
            pass

        assert captured_messages, "Expected provider.call_model to receive messages"
        system_prompt = captured_messages[0][0]["content"]
        assert "VOICE ANCHOR" in system_prompt
        assert "Do not use feeling" in system_prompt

    async def test_generate_beat_threads_voice_anchor_to_subagent_system(
        self, director, mock_provider
    ):
        # Force the beat to yield one agent_speak so the character
        # sub-agent rewrite path is exercised.
        beat_events = json.dumps([
            {
                "type": "agent_speak",
                "data": {
                    "character_id": "Walter White",
                    "content": "starter",
                    "emotion_state": "calm",
                    "gif_search_query": "walter calm",
                },
                "recommended_model": "stepfun/step-3.7-flash",
            }
        ])
        captured_messages: list = []

        # Director planning call (call_model) returns the beat events; the
        # character sub-agent rewrite now routes through call_model_with_tools
        # (native function calling, DEC-0001) returning a ModelResult. Both
        # capture their message list so we can inspect the VOICE ANCHOR block
        # prepended to the sub-agent system prompt.
        def _plan_capture(messages, route):
            captured_messages.append(messages)
            return beat_events

        async def _rewrite_capture(messages, *args, **kwargs):
            captured_messages.append(messages)
            return _mr("starter reply")

        mock_provider.call_model = AsyncMock(side_effect=_plan_capture)
        mock_provider.call_model_with_tools = AsyncMock(side_effect=_rewrite_capture)
        mock_provider.resolve_model_route = MagicMock(
            return_value="stepfun/step-3.7-flash"
        )

        async for _ in director._generate_beat(
            task="t",
            outline="1. office - meet",
            beat_index=0,
            context={"previous_scene": "", "current_scene": "office"},
            voice_example="Do not use feeling. Weigh it, record it, verify it.",
        ):
            pass

        # The character sub-agent rewrite call is the second capture.
        # Its system message must contain the VOICE ANCHOR block so the
        # cadence / relationship pressure set by the user reaches Walter's
        # rewrite, not just the Director layer.
        assert len(captured_messages) >= 2
        sub_agent_system = captured_messages[1][0]["content"]
        assert "VOICE ANCHOR" in sub_agent_system, (
            f"Voice anchor must be prepended to character sub-agent system prompt. "
            f"Got: {sub_agent_system[:200]}"
        )
        assert "Do not use feeling" in sub_agent_system

    async def test_process_passes_voice_anchor_to_generate_beat(self, director):
        director._generate_outline = AsyncMock(return_value="1. RV - Walt waits")
        calls: list[dict] = []

        async def fake_beat(*args, **kwargs):
            calls.append(kwargs)
            yield MagicMock(type="beat_ready", data={"beat_id": "beat_1"})

        director._generate_beat = fake_beat

        async for _ in director.process(
            task="t",
            voice_example="Yo, Mr. White.",
        ):
            pass

        assert calls[0]["voice_example"] == "Yo, Mr. White."
