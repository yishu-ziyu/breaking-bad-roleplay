"""Unit tests for MiniMax TTS helpers (no live network)."""

from __future__ import annotations

import pytest

from agents.tts import TTSError, _hex_to_bytes, synthesize_character_speech
from agents.voice_casting import CLONE_VOICE_IDS, get_clone_voice_id


def test_clone_map_covers_verified_trio():
    assert set(CLONE_VOICE_IDS) == {"walter", "gus", "mike"}
    assert get_clone_voice_id("jesse") is None


def test_hex_to_bytes_roundtrip():
    raw = b"ID3fake"
    assert _hex_to_bytes(raw.hex()) == raw


@pytest.mark.asyncio
async def test_synthesize_rejects_unknown_character():
    with pytest.raises(TTSError) as ei:
        await synthesize_character_speech(
            text="hi",
            character_id="jesse",
            language="en",
            api_key="k",
        )
    assert ei.value.status_code == 404


@pytest.mark.asyncio
async def test_synthesize_rejects_empty_text():
    with pytest.raises(TTSError) as ei:
        await synthesize_character_speech(
            text="   ",
            character_id="walter",
            language="en",
            api_key="k",
        )
    assert ei.value.status_code == 400


@pytest.mark.asyncio
async def test_synthesize_rejects_missing_key():
    with pytest.raises(TTSError) as ei:
        await synthesize_character_speech(
            text="hello",
            character_id="walter",
            language="en",
            api_key="",
        )
    assert ei.value.status_code == 503
