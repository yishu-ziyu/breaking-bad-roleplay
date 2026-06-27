"""SDD+TDD tests for Director agent bug fixes (B1, B2, B5)."""

from __future__ import annotations

import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from models.schemas import AgentEvent


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_provider():
    provider = MagicMock()
    provider.call_model = AsyncMock()
    provider.resolve_model_route = MagicMock(return_value="minimax/MiniMax-M3")
    return provider


@pytest.fixture
def director(mock_provider):
    from agents.director import DirectorAgent
    return DirectorAgent(provider=mock_provider)


# ===================================================================
# B1: Outline returns JSON array — _parse_outline must handle it
# ===================================================================

class TestB1_OutlineParsing:
    """Scenario: LLM returns JSON array instead of text list."""

    async def test_parse_outline_from_json_array(self, director):
        """Given LLM returns a JSON array of scenes, _parse_outline extracts descriptions."""
        json_response = json.dumps([
            {"scene": "RV in the desert", "description": "Walt and Jesse cook meth"},
            {"scene": "White family kitchen", "description": "Skyler confronts Walt"},
        ])
        scenes = director._parse_outline(json_response)
        # Then: we get at least 2 scene descriptions, not raw JSON brackets
        assert len(scenes) >= 2
        # And: none of the scenes starts with '[' or '{'
        for s in scenes:
            assert not s.strip().startswith('['), f"Scene is raw JSON: {s[:50]}"
            assert not s.strip().startswith('{'), f"Scene is raw JSON: {s[:50]}"

    async def test_parse_outline_from_text_list(self, director):
        """Given LLM returns a normal numbered text list, _parse_outline works."""
        text = "1. RV in the desert - Walt and Jesse cook meth\n2. White family kitchen - Skyler confronts Walt"
        scenes = director._parse_outline(text)
        assert len(scenes) == 2
        assert "RV" in scenes[0]
        assert "kitchen" in scenes[1]

    async def test_parse_outline_strips_json_fenced(self, director):
        """Given LLM wraps JSON in code fence, _parse_outline extracts clean text."""
        response = '```json\n[\n  {"scene": "Lab", "desc": "Cooking"},\n  {"scene": "Office", "desc": "Gus"}\n]\n```'
        scenes = director._parse_outline(response)
        for s in scenes:
            assert '[' not in s[:5], "Leading bracket should be stripped"
            assert '{' not in s[:5], "Leading brace should be stripped"


# ===================================================================
# B2: Beat summary must not contain raw LLM output
# ===================================================================

class TestB2_BeatSummaryClean:
    """Scenario: beat_summary from _beat_ready_event must be readable text."""

    def test_beat_ready_summary_no_json_markers(self, director):
        """Given a clean scene description, _beat_ready_event produces clean summary."""
        summary = "RV in the desert - Walt and Jesse cook meth"
        event = director._beat_ready_event(0, summary)
        assert event.data["beat_summary"] == summary
        assert not event.data["beat_summary"].strip().startswith('[')
        assert not event.data["beat_summary"].strip().startswith('{')

    def test_beat_ready_has_required_fields(self, director):
        """Given any summary, _beat_ready_event produces valid event structure."""
        event = director._beat_ready_event(3, "Some scene")
        assert event.type == "beat_ready"
        assert "beat_id" in event.data
        assert "beat_summary" in event.data
        assert event.data["beat_id"] == "beat_4"


# ===================================================================
# B5: Crew chat must return non-empty debate_logs
# ===================================================================

class TestB5_CrewChat:
    """Scenario: crew mode returns meaningful debate logs."""

    async def test_crew_chat_returns_debate_logs(self, director, mock_provider):
        """Given crew mode with valid LLM response, debate_logs is non-empty."""
        mock_provider.call_model.return_value = json.dumps([
            {
                "character_id": "Walter White",
                "content": "We need to discuss the lab situation.",
                "emotion_state": "tense",
                "gif_search_query": "walter white serious",
                "thinking": "This is not ideal.",
                "tool_executed": None,
                "tool_log": None,
            },
            {
                "character_id": "Jesse Pinkman",
                "content": "Yeah, what he said.",
                "emotion_state": "anxious",
                "gif_search_query": "jesse pinkman nervous",
                "thinking": None,
                "tool_executed": None,
                "tool_log": None,
            },
        ])
        context = {
            "mode": "crew",
            "history": [],
            "language": "en",
            "relation": "partner",
            "llmProvider": "minimax",
        }
        result = await director._handle_crew_chat("walter", "What's the plan?", context)
        assert len(result["debate_logs"]) >= 1
        for log in result["debate_logs"]:
            assert "text" in log
            assert len(log["text"]) > 0, "Debate log entry has empty text"

    async def test_crew_chat_parses_fenced_json(self, director, mock_provider):
        """Given LLM wraps JSON in code fence, it is still parsed."""
        mock_provider.call_model.return_value = '```json\n[\n  {\n    "character_id": "Gus Fring",\n    "content": "Let us discuss business.",\n    "emotion_state": "calm",\n    "gif_search_query": "gus fring calm",\n    "thinking": null,\n    "tool_executed": null,\n    "tool_log": null\n  }\n]\n```'
        context = {
            "mode": "crew",
            "history": [],
            "language": "en",
            "relation": "partner",
            "llmProvider": "minimax",
        }
        result = await director._handle_crew_chat("gus", "Business?", context)
        assert len(result["debate_logs"]) >= 1
        text = result["debate_logs"][0]["text"]
        assert "discuss" in text.lower(), f"Expected 'discuss' in debate log text: {text}"

    async def test_crew_chat_handles_malformed_json(self, director, mock_provider):
        """Given LLM returns garbage, crew chat does not crash."""
        mock_provider.call_model.return_value = "This is not JSON at all, sorry!"
        context = {
            "mode": "crew",
            "history": [],
            "language": "en",
            "relation": "partner",
            "llmProvider": "minimax",
        }
        result = await director._handle_crew_chat("walter", "Hello?", context)
        assert "debate_logs" in result
        assert isinstance(result["debate_logs"], list)


# ===================================================================
# Cycle 3 PR-A: redirect / switch_perspective / continue dict signals
# ===================================================================

class TestCycle3_ActionSignalHandling:
    """Scenario: routes.py pushes dict signals; Director.process must
    dispatch them (regenerate outline on redirect, no-op fall-through
    on continue / switch_perspective) instead of blocking 5 minutes and
    continuing with the stale task."""

    @staticmethod
    def _fake_beat_factory(record: list[dict]):
        """Return an async-gen function that yields one beat_ready event
        and records its call kwargs into `record`."""
        async def _fake_beat(*args, **kwargs):
            record.append(kwargs)
            yield AgentEvent(
                type="beat_ready",
                data={"beat_id": "beat_1", "beat_summary": "fake beat"},
            )
        return _fake_beat

    async def test_redirect_signal_regenerates_outline(self, director):
        """Given a redirect dict in the action queue, process() calls
        _generate_outline a second time and emits a new outline event."""
        first_outline = "1. RV in the desert — Walt and Jesse cook\n2. White house — Skyler waits"
        second_outline = "1. Brand new scene — the superlab"

        director._generate_outline = AsyncMock(
            side_effect=[first_outline, second_outline]
        )
        beat_calls: list[dict] = []
        director._generate_beat = self._fake_beat_factory(beat_calls)

        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        queue.put_nowait({"action": "redirect", "prompt": "new direction"})

        events: list[AgentEvent] = []
        async for ev in director.process(task="original task", action_queue=queue):
            events.append(ev)

        outline_events = [e for e in events if e.type == "outline"]
        assert len(outline_events) == 2, (
            f"Expected 2 outline events (initial + redirect), got {len(outline_events)}"
        )
        assert outline_events[1].data["content"] == second_outline

    async def test_redirect_outline_regeneration_failure_fallback(self, director):
        """Given redirect + _generate_outline returns None the second time,
        process() emits a fallback status and continues rendering the next
        beat using the OLD outline."""
        first_outline = "1. RV in the desert — cook\n2. White house — Skyler"

        director._generate_outline = AsyncMock(
            side_effect=[first_outline, None]
        )
        beat_calls: list[dict] = []
        director._generate_beat = self._fake_beat_factory(beat_calls)

        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        queue.put_nowait({"action": "redirect", "prompt": "new direction"})

        events: list[AgentEvent] = []
        async for ev in director.process(task="original task", action_queue=queue):
            events.append(ev)

        status_msgs = [
            e.data.get("message", "") for e in events if e.type == "status"
        ]
        assert any(
            "Redirect applied but outline regeneration failed" in m for m in status_msgs
        ), f"Expected fallback status message, got: {status_msgs}"
        # Continued with old outline: _generate_beat called for beat 0 and beat 1,
        # both with the original outline.
        assert len(beat_calls) == 2, (
            f"Expected 2 beats after fallback, got {len(beat_calls)}"
        )
        assert beat_calls[1]["outline"] == first_outline

    async def test_continue_signal_dict_type(self, director):
        """Given a continue dict (not the legacy 'continue' string),
        process() does not raise and advances to the next beat."""
        outline = "1. RV in the desert — cook\n2. White house — Skyler"
        director._generate_outline = AsyncMock(return_value=outline)
        beat_calls: list[dict] = []
        director._generate_beat = self._fake_beat_factory(beat_calls)

        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        queue.put_nowait({"action": "continue"})

        events: list[AgentEvent] = []
        # Should not raise.
        async for ev in director.process(task="task", action_queue=queue):
            events.append(ev)

        # Both beats rendered and session completed.
        assert len(beat_calls) == 2, (
            f"Expected both beats to render, got {len(beat_calls)}"
        )
        assert any(e.type == "complete" for e in events), (
            "Expected a complete event after continue"
        )

    async def test_switch_perspective_signal_does_not_deadlock(self, director):
        """Given a switch_perspective dict, process() does not block and
        advances to the next beat (perspective semantics deferred)."""
        outline = "1. RV in the desert — cook\n2. White house — Skyler"
        director._generate_outline = AsyncMock(return_value=outline)
        beat_calls: list[dict] = []
        director._generate_beat = self._fake_beat_factory(beat_calls)

        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        queue.put_nowait({"action": "switch_perspective", "target": "Jesse Pinkman"})

        events: list[AgentEvent] = []
        async for ev in director.process(task="task", action_queue=queue):
            events.append(ev)

        assert len(beat_calls) == 2, (
            f"Expected both beats to render, got {len(beat_calls)}"
        )
        assert any(e.type == "complete" for e in events), (
            "Expected a complete event after switch_perspective"
        )


# ===================================================================
# Cycle 4: switch_perspective perspective semantics
# ===================================================================

class TestCycle4_PerspectiveSemantics:
    """Scenario: switch_perspective signal should set active_character_id
    (mapped to backend full-name form) so the next beat's first agent_speak
    matches the target character."""

    @pytest.fixture
    def mock_db(self):
        """Mock AsyncSession for db fallback tests. Added per drill BLOCKED 1:
        test_director_bugfixes.py:17-28 only defines mock_provider/director,
        no conftest.py exists, so mock_db must be defined here."""
        from unittest.mock import MagicMock, AsyncMock
        db = MagicMock()
        db.execute = AsyncMock()
        return db

    @staticmethod
    def _fake_beat_factory(record: list[dict]):
        async def _fake_beat(*args, **kwargs):
            record.append(kwargs)
            yield AgentEvent(
                type="beat_ready",
                data={"beat_id": "beat_1", "beat_summary": "fake beat"},
            )
        return _fake_beat

    async def test_switch_perspective_signal_sets_active_character_id(self, director):
        """Given switch_perspective signal with target='jesse', the next
        _generate_beat call receives active_character_id='Jesse Pinkman'."""
        director._generate_outline = AsyncMock(
            return_value="1. RV — cook\n2. White house — Skyler waits"
        )
        beat_calls: list[dict] = []
        director._generate_beat = self._fake_beat_factory(beat_calls)

        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        queue.put_nowait({"action": "switch_perspective", "target": "jesse"})

        events: list[AgentEvent] = []
        async for ev in director.process(task="t", action_queue=queue):
            events.append(ev)

        # beat_calls[0] is beat 0 (before switch), beat_calls[1] is beat 1 (after switch)
        assert len(beat_calls) == 2
        assert beat_calls[1]["active_character_id"] == "Jesse Pinkman", (
            f"Expected 'Jesse Pinkman', got {beat_calls[1].get('active_character_id')}"
        )

    async def test_switch_perspective_short_id_mapped_to_full_name(self, director):
        """Given target='walter' (short id), active_character_id='Walter White'."""
        director._generate_outline = AsyncMock(
            return_value="1. RV — cook\n2. White house — Skyler waits"
        )
        beat_calls: list[dict] = []
        director._generate_beat = self._fake_beat_factory(beat_calls)

        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        queue.put_nowait({"action": "switch_perspective", "target": "walter"})

        async for ev in director.process(task="t", action_queue=queue):
            pass

        assert beat_calls[1]["active_character_id"] == "Walter White"

    async def test_switch_perspective_db_fallback(self, director, mock_db):
        """Given signal without 'target' key, director reads db and maps."""
        director._generate_outline = AsyncMock(
            return_value="1. RV — cook\n2. White house — Skyler waits"
        )
        beat_calls: list[dict] = []
        director._generate_beat = self._fake_beat_factory(beat_calls)

        # mock_db.execute returns a scalar of "skyler"
        mock_db.execute = AsyncMock(
            return_value=_MockScalar("skyler")
        )

        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        queue.put_nowait({"action": "switch_perspective"})  # no target key

        async for ev in director.process(
            task="t", action_queue=queue, db=mock_db, session_id="s1"
        ):
            pass

        assert beat_calls[1]["active_character_id"] == "Skyler White"

    async def test_switch_perspective_redirect_preserves_perspective(self, director):
        """Given switch_perspective then redirect, active_character_id persists."""
        # 3 scenes (not 2): director.py:198 `if idx < len(scenes) - 1` means
        # the last beat doesn't wait for action. With 2 scenes, beat 1 (last)
        # never consumes the redirect signal. 3 scenes → beat 1 waits, consumes
        # redirect, regenerates outline → beat_calls = [beat0, beat1, beat0_new].
        first_outline = "1. RV — cook\n2. White house — Skyler waits\n3. DEA office — Hank"
        second_outline = "1. Brand new scene"
        director._generate_outline = AsyncMock(
            side_effect=[first_outline, second_outline]
        )
        beat_calls: list[dict] = []
        director._generate_beat = self._fake_beat_factory(beat_calls)

        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        queue.put_nowait({"action": "switch_perspective", "target": "jesse"})
        queue.put_nowait({"action": "redirect", "prompt": "new direction"})

        async for ev in director.process(task="t", action_queue=queue):
            pass

        # After redirect, new outline's first beat should still have active_character_id
        # beat_calls: [beat0_orig, beat1_after_switch, beat0_new_outline]
        assert len(beat_calls) == 3
        assert beat_calls[2]["active_character_id"] == "Jesse Pinkman"

    async def test_switch_perspective_no_target_keeps_none(self, director):
        """Given signal without target and no db, active_character_id stays None."""
        director._generate_outline = AsyncMock(
            return_value="1. RV — cook\n2. White house — Skyler waits"
        )
        beat_calls: list[dict] = []
        director._generate_beat = self._fake_beat_factory(beat_calls)

        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        queue.put_nowait({"action": "switch_perspective"})  # no target, no db

        async for ev in director.process(task="t", action_queue=queue):
            pass

        assert beat_calls[1]["active_character_id"] is None

    async def test_beat_prompt_contains_active_character(self, director, mock_provider):
        """Given active_character_id, beat_prompt sent to LLM contains the
        active character line."""
        captured_messages = []
        async def capture(messages, route=None):
            captured_messages.append(messages)
            return '[{"type":"beat_ready","data":{},"recommended_model":"stepfun/step-3.7-flash"}]'
        mock_provider.call_model = AsyncMock(side_effect=capture)
        mock_provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")

        outline = "1. RV — cook"
        async for _ in director._generate_beat(
            task="t", outline=outline, beat_index=0,
            context={"previous_scene": "", "current_scene": "RV"},
            active_character_id="Jesse Pinkman",
        ):
            pass

        user_prompt = captured_messages[0][1]["content"]
        assert "Active perspective character: Jesse Pinkman" in user_prompt
        assert "FIRST agent_speak" in user_prompt

    async def test_filter_reorders_first_agent_speak_to_target(self, director, mock_provider):
        """Given LLM returns walter-first events but active=jesse, filter
        hoists jesse speak to first agent_speak position."""
        llm_events = [
            {"type": "scene_change", "data": {}, "recommended_model": "stepfun/step-3.7-flash"},
            {"type": "agent_speak", "data": {"character_id": "Walter White", "content": "..."}, "recommended_model": "stepfun/step-3.7-flash"},
            {"type": "agent_speak", "data": {"character_id": "Jesse Pinkman", "content": "..."}, "recommended_model": "stepfun/step-3.7-flash"},
            {"type": "world_state_delta", "data": {"deltas": []}, "recommended_model": "stepfun/step-3.7-flash"},
        ]
        mock_provider.call_model = AsyncMock(return_value=json.dumps(llm_events))
        mock_provider.resolve_model_route = MagicMock(return_value="stepfun/step-3.7-flash")

        events_yielded = []
        async for ev in director._generate_beat(
            task="t", outline="1. RV — cook", beat_index=0,
            context={"previous_scene": "", "current_scene": "RV"},
            active_character_id="Jesse Pinkman",
        ):
            events_yielded.append(ev)

        speak_events = [e for e in events_yielded if e.type == "agent_speak"]
        assert len(speak_events) == 2
        assert speak_events[0].data["character_id"] == "Jesse Pinkman", (
            f"Expected first agent_speak to be Jesse Pinkman, got {speak_events[0].data.get('character_id')}"
        )
        assert speak_events[1].data["character_id"] == "Walter White"


class _MockScalar:
    """Mock for sqlalchemy scalar result."""
    def __init__(self, value):
        self._value = value
    def scalar_one_or_none(self):
        return self._value
