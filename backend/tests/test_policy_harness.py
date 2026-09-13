"""Policy harness runs probes through Direct / Crew / Story adapters."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from agents.character_policy import compile_character_policy
from agents.director import DirectorAgent
from eval.policy_harness import load_probes, run_probe_on_adapters


@pytest.fixture
def director():
    provider = MagicMock()
    provider.resolve_model_route.return_value = "stepfun/step-3.7-flash"
    return DirectorAgent(provider, enable_dossier_updates=False)


def test_probes_exist():
    probes = load_probes()
    assert any(p.get("id") == "walter.s1.exit_pressure" for p in probes)


@pytest.mark.asyncio
async def test_good_mock_passes_three_modes(director):
    probe = load_probes()[0]
    results = await run_probe_on_adapters(probe, director=director, good=True)
    modes = {r.play_mode for r in results}
    assert modes == {"direct", "crew", "story"}
    assert all(r.ok for r in results)
    versions = {compile_character_policy("walter", era="s1", play_mode=m).version for m in modes}
    assert len(versions) == 1


@pytest.mark.asyncio
async def test_felina_confession_fails_probe(director):
    probe = load_probes()[0]
    results = await run_probe_on_adapters(probe, director=director, good=False)
    assert any("forbidden:" in e for r in results for e in r.errors)
