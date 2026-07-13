"""MiniMax T2A speech synthesis for cloned character voices."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from agents.voice_casting import (
    DEFAULT_T2A_MODEL,
    MINIMAX_SPEECH_BASE,
    get_clone_voice_id,
)

logger = logging.getLogger(__name__)


class TTSError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _hex_to_bytes(audio_hex: str) -> bytes:
    cleaned = audio_hex.strip()
    if cleaned.startswith("0x"):
        cleaned = cleaned[2:]
    return bytes.fromhex(cleaned)


async def synthesize_character_speech(
    *,
    text: str,
    character_id: str,
    language: str,
    api_key: str,
    client: httpx.AsyncClient | None = None,
    model: str = DEFAULT_T2A_MODEL,
) -> tuple[bytes, str]:
    """Return (audio_bytes, mime_type) for a cloned character voice.

    Raises TTSError when the character has no clone or MiniMax fails.
    """
    voice_id = get_clone_voice_id(character_id)
    if not voice_id:
        raise TTSError(
            f"No cloned voice for character '{character_id}'.",
            status_code=404,
        )
    if not api_key:
        raise TTSError("MINIMAX_API_KEY is not configured.", status_code=503)

    text = (text or "").strip()
    if not text:
        raise TTSError("text is required.", status_code=400)
    # Keep requests bounded for interactive UI clicks.
    if len(text) > 2000:
        text = text[:2000]

    language_boost = "Chinese" if language.startswith("zh") else "English"
    payload: dict[str, Any] = {
        "model": model,
        "text": text,
        "stream": False,
        "language_boost": language_boost,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": 1,
            "vol": 1,
            "pitch": 0,
        },
        "audio_setting": {
            "format": "mp3",
            "sample_rate": 32000,
        },
    }

    owns_client = client is None
    http = client or httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5.0, read=90.0, write=30.0, pool=5.0),
        trust_env=False,
    )
    try:
        resp = await http.post(
            f"{MINIMAX_SPEECH_BASE}/v1/t2a_v2",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    except httpx.HTTPError as exc:
        logger.exception("MiniMax T2A network error")
        raise TTSError(f"TTS network error: {exc}", status_code=502) from exc
    finally:
        if owns_client:
            await http.aclose()

    try:
        data = resp.json()
    except Exception as exc:
        raise TTSError(
            f"TTS returned non-JSON (HTTP {resp.status_code}).",
            status_code=502,
        ) from exc

    base = data.get("base_resp") or {}
    code = base.get("status_code", 0 if resp.is_success else resp.status_code)
    if code not in (0, None):
        msg = base.get("status_msg") or f"TTS failed with status {code}"
        logger.warning("MiniMax T2A error character=%s code=%s msg=%s", character_id, code, msg)
        raise TTSError(msg, status_code=502)

    audio_field = None
    if isinstance(data.get("data"), dict):
        audio_field = data["data"].get("audio")
    audio_field = audio_field or data.get("audio")
    if not audio_field or not isinstance(audio_field, str):
        raise TTSError("TTS response missing audio payload.", status_code=502)

    if audio_field.startswith("http"):
        # Rare path: signed URL instead of hex.
        async with httpx.AsyncClient(timeout=60.0, trust_env=False) as dl:
            audio_resp = await dl.get(audio_field)
            audio_resp.raise_for_status()
            return audio_resp.content, "audio/mpeg"

    try:
        return _hex_to_bytes(audio_field), "audio/mpeg"
    except ValueError as exc:
        raise TTSError("TTS audio was not valid hex.", status_code=502) from exc
