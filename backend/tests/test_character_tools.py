"""TDD: every character declares real tools and their executors run.

Sets dummy env so importing ``agents.provider`` works without a real ``.env``.
"""
import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from types import SimpleNamespace

from agents.provider import ProviderFacade
from agents.characters import (
    WalterWhite,
    SaulGoodman,
    MikeEhrmantraut,
    GusFring,
    JessePinkman,
    SkylerWhite,
)
from agents.tools import ToolResult


def _facade() -> ProviderFacade:
    return ProviderFacade(
        settings=SimpleNamespace(
            minimax_api_key="k",
            stepfun_api_key="k",
            cli_proxy_base_url="http://x",
            cli_proxy_api_key="k",
            cli_proxy_default_model="m",
        )
    )


async def test_all_six_characters_have_tools():
    for cls in (WalterWhite, SaulGoodman, MikeEhrmantraut, GusFring, JessePinkman, SkylerWhite):
        c = cls(_facade())
        assert len(c.tools) >= 1, f"{cls.__name__} should declare at least one tool"


async def test_walter_tool_executes():
    c = WalterWhite(_facade())
    res = await c._tool_registry.execute(
        "lab_pressure_simulator", {"compound": "meth", "temperature_c": 200, "pressure_psi": 100}
    )
    assert isinstance(res, ToolResult)
    assert any(s in res.content for s in ("STABLE", "CRITICAL", "UNSTABLE"))


async def test_saul_tool_executes():
    c = SaulGoodman(_facade())
    res = await c._tool_registry.execute("legal_risk_assessor", {"action_description": "launder money"})
    assert "HIGH" in res.content


async def test_mike_tool_executes():
    c = MikeEhrmantraut(_facade())
    res = await c._tool_registry.execute("security_posture_reader", {"location": "superlab"})
    assert "SECURE" in res.content


async def test_gus_tool_executes():
    c = GusFring(_facade())
    res = await c._tool_registry.execute("compliance_checker", {"operation": "kill civilian"})
    assert "NON_COMPLIANT" in res.content


async def test_jesse_tool_executes():
    c = JessePinkman(_facade())
    res = await c._tool_registry.execute(
        "cook_yield_estimator", {"batch_size_oz": 10, "purity_target_percent": 99}
    )
    assert "PHARM-GRADE" in res.content


async def test_skyler_tool_executes():
    c = SkylerWhite(_facade())
    res = await c._tool_registry.execute(
        "financial_exposure_check", {"venture": "car wash", "amount_usd": 1000}
    )
    assert "LOW" in res.content
