"""Tests for Director beat JSON parsing resilience."""
import pytest
from agents.director import DirectorAgent


class TestBeatParsing:
    def test_parse_plain_json_array(self):
        """Standard JSON array should parse."""
        raw = '[{"type":"agent_speak","data":{"character_id":"Walter White","content":"test"}}]'
        events = DirectorAgent._parse_beat_events(raw)
        assert len(events) == 1
        assert events[0]["type"] == "agent_speak"

    def test_parse_json_with_code_fence(self):
        """JSON wrapped in ```json fence should parse."""
        raw = '```json\n[{"type":"agent_think","data":{"character_id":"Jesse","thought_content":"test"}}]\n```'
        events = DirectorAgent._parse_beat_events(raw)
        assert len(events) == 1
        assert events[0]["type"] == "agent_think"

    def test_parse_json_with_extra_text_before(self):
        """JSON preceded by explanation text should still extract."""
        raw = 'Here are the events:\n[{"type":"agent_act","data":{"character_id":"Walter","action":"test"}}]\nHope this helps!'
        events = DirectorAgent._parse_beat_events(raw)
        assert len(events) == 1
        assert events[0]["type"] == "agent_act"

    def test_parse_single_json_object_wraps_in_array(self):
        """Single JSON object (not array) should be wrapped in array."""
        raw = '{"type":"agent_speak","data":{"character_id":"Walter White","content":"test"}}'
        events = DirectorAgent._parse_beat_events(raw)
        assert len(events) == 1
        assert events[0]["type"] == "agent_speak"

    def test_parse_empty_returns_empty(self):
        """Non-JSON text returns empty list."""
        raw = 'Walter walks into the room and says hello.'
        events = DirectorAgent._parse_beat_events(raw)
        assert events == []
