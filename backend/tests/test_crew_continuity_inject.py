"""Crew mode: each participant gets their own Continuity Board slice.

Crew still uses one multi-character LLM call, but each CHARACTER VOICE
block must carry only facts that speaker would know.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.director import DirectorAgent
from agents.provider import ProviderFacade


@pytest.fixture
def mock_provider():
    provider = MagicMock(spec=ProviderFacade)
    provider.resolve_model_route.return_value = "stepfun/step-3.7-flash"
    provider.call_model = AsyncMock(
        return_value=json.dumps(
            [
                {
                    "character_id": "Walter White",
                    "content": "We stay precise.",
                    "emotion_state": "tense",
                    "gif_search_query": "walter serious",
                    "thinking": None,
                    "tool_executed": None,
                    "tool_log": None,
                },
                {
                    "character_id": "Jesse Pinkman",
                    "content": "Yeah, whatever.",
                    "emotion_state": "anxious",
                    "gif_search_query": "jesse nervous",
                    "thinking": None,
                    "tool_executed": None,
                    "tool_log": None,
                },
            ]
        )
    )
    provider.cli_proxy_default_model = "gpt-5.4"
    return provider


@pytest.fixture
def director(mock_provider):
    return DirectorAgent(mock_provider, enable_dossier_updates=False)


@pytest.mark.asyncio
async def test_crew_injects_per_speaker_board_slices(director, mock_provider):
    context = {
        "mode": "crew",
        "history": [],
        "language": "en",
        "relation": "partner",
        "llmProvider": "stepfun",
    }
    result = await director._handle_crew_chat(
        "walter", "Jesse, what's the plan with Gus?", context
    )
    assert result["debate_logs"]

    messages = mock_provider.call_model.call_args.args[0]
    system = messages[0]["content"]
    assert "CONTINUITY BOARD" in system
    assert "KNOWLEDGE RIGHTS" in system
    # Walt and Jesse both present in voice guides
    assert "CHARACTER VOICE: Walter White" in system
    assert "CHARACTER VOICE: Jesse Pinkman" in system

    # Split by character blocks; Jesse block must not leak Skyler household fact
    jesse_idx = system.find("CHARACTER VOICE: Jesse Pinkman")
    assert jesse_idx >= 0
    next_sep = system.find("\n\n---\n\n", jesse_idx)
    jesse_block = system[jesse_idx: next_sep if next_sep > 0 else None]
    assert "household story is incomplete" not in jesse_block
    # Jesse should still see Gus-roof operational fact
    assert "Gus" in jesse_block or "cook" in jesse_block.lower()


@pytest.mark.asyncio
async def test_crew_skyler_block_hides_gus_roof(director, mock_provider):
    mock_provider.call_model.return_value = json.dumps(
        [
            {
                "character_id": "Skyler White",
                "content": "I need the truth about this house.",
                "emotion_state": "tense",
                "gif_search_query": "skyler tense",
                "thinking": None,
                "tool_executed": None,
                "tool_log": None,
            }
        ]
    )
    context = {
        "mode": "crew",
        "history": [],
        "language": "en",
        "relation": "family member",
        "llmProvider": "stepfun",
    }
    await director._handle_crew_chat("skyler", "Skyler wants answers", context)
    system = mock_provider.call_model.call_args.args[0][0]["content"]
    sky_idx = system.find("CHARACTER VOICE: Skyler White")
    assert sky_idx >= 0
    next_sep = system.find("\n\n---\n\n", sky_idx)
    sky_block = system[sky_idx: next_sep if next_sep > 0 else None]
    # Skyler must not receive Gus-roof operational map as known fact text
    # (s3 pack hides s3_gus_roof from skyler)
    assert "under Gus Fring's organization" not in sky_block
    assert "household story is incomplete" in sky_block or "incomplete" in sky_block.lower()
