"""Character -> MiniMax cloned voice_id mapping.

Only characters with verified clones are listed. Others fall back to
browser speechSynthesis on the client.
"""

from __future__ import annotations

# Locked after user-approved labels + clone quality check (2026-07-13+).
# Source: YT pPZF6zAwC5U (Walter/Gus/Mike); YT HTWPU0Ore_k (Skyler, pitch-cleaned).
CLONE_VOICE_IDS: dict[str, str] = {
    "walter": "bbclone_walter_v1",
    "gus": "bbclone_gus_v1",
    "mike": "bbclone_mike_v1",
    "skyler": "bbclone_skyler_v1",
    "saul": "bbclone_saul_v1",
    "jesse": "bbclone_jesse_v1",
}

DEFAULT_T2A_MODEL = "speech-2.8-hd"
MINIMAX_SPEECH_BASE = "https://api.minimaxi.com"


def get_clone_voice_id(character_id: str) -> str | None:
    return CLONE_VOICE_IDS.get(character_id)
