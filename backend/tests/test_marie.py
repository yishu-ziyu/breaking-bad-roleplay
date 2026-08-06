"""TDD: Marie Schrader character prompt — 6 verbs + knowledge boundaries.

Marie is the first playable character without fictional tools.
She operates through observation, pressure, and relationship dynamics.
"""

from __future__ import annotations

import os

os.environ.setdefault("MINIMAX_API_KEY", "dummy")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost:5432/dummy")

from types import SimpleNamespace

from agents.provider import ProviderFacade
from agents.characters.marie import MarieSchrader, MARIE_SYSTEM_PROMPT


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


# ── 6 core verbs ──────────────────────────────────────────────

VERBS = [
    "defend_family_member",
    "confront_threat_directly",
    "cite_clinical_authority_as_shield",
    "snap_then_walk_back",
    "purple_or_petshop_redirect",
    "demand_accountability",
]


def test_all_six_verbs_are_documented_in_prompt():
    """Every verb from the research phase must appear in the system prompt."""
    for verb in VERBS:
        assert verb in MARIE_SYSTEM_PROMPT, f"Missing verb: {verb}"


def test_verb_descriptions_have_show_context():
    """Each verb should carry a show-era reference so the LLM does not invent one."""
    assert "S5E11" in MARIE_SYSTEM_PROMPT or "extreme endpoint" in MARIE_SYSTEM_PROMPT


# ── Identity pillars ──────────────────────────────────────────

IDENTITY_MARKERS = [
    "Public mask",
    "Inner engine",
    "Main contradiction",
    "Failure mode",
    "purple",
    "interior decorating",
    "protective sisterly",
]


def test_identity_pillars_present():
    for marker in IDENTITY_MARKERS:
        assert marker in MARIE_SYSTEM_PROMPT, f"Missing identity marker: {marker}"


# ── Voice rules ───────────────────────────────────────────────

VOICE_MARKERS = [
    "observational",
    "decorative",
    "Status-aware",
    "Chinese",
    "Mandarin",
    "internet slang",
]


def test_voice_rules_present():
    for marker in VOICE_MARKERS:
        assert marker in MARIE_SYSTEM_PROMPT, f"Missing voice marker: {marker}"


# ── Relationship rules ────────────────────────────────────────

RELATION_MARKERS = [
    "Skyler sister-in-law",
    "Hank spouse",
    "supportive but uncomprehending",
]


def test_relationship_rules_present():
    for marker in RELATION_MARKERS:
        assert marker in MARIE_SYSTEM_PROMPT, f"Missing relation: {marker}"


# ── Knowledge boundaries ──────────────────────────────────────

BOUNDARY_MARKERS = [
    "Continuity Board",
    "known_by",
    "cooking facts",
    "DEA",
    "BCS-era",
    "Better Call Saul",
]


def test_knowledge_boundaries_present():
    for marker in BOUNDARY_MARKERS:
        assert marker in MARIE_SYSTEM_PROMPT, f"Missing boundary marker: {marker}"


def test_does_not_claim_operational_knowledge():
    """Marie must not pretend to know cooking, distribution, or DEA procedure."""
    assert "does not magically know" in MARIE_SYSTEM_PROMPT


# ── Safety rules ──────────────────────────────────────────────

SAFETY_MARKERS = [
    "Stay in character",
    "never admit being AI",
    "Original lines only",
    "no famous monologues",
    "No real-world crime how-to",
]


def test_safety_rules_present():
    for marker in SAFETY_MARKERS:
        assert marker in MARIE_SYSTEM_PROMPT, f"Missing safety marker: {marker}"


# ── Instantiation ─────────────────────────────────────────────

def test_marie_can_be_instantiated():
    c = MarieSchrader(_facade())
    assert c.name == "Marie Schrader"
    assert c.system_prompt() == MARIE_SYSTEM_PROMPT


def test_marie_has_no_tools():
    """Marie operates through observation and pressure, not tooling."""
    c = MarieSchrader(_facade())
    assert c.tools == []
    assert c.tool_executors == {}


def test_marie_system_prompt_length():
    """Prompt should be substantial enough to guide character behavior."""
    assert len(MARIE_SYSTEM_PROMPT) > 1500