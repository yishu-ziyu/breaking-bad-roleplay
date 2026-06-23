"""SDD+TDD tests for Director agent bug fixes (B1, B2, B5)."""

from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock


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
