"""Policy harness: run probes through Direct / Crew / Story adapters.

Evaluation-only. Does not replace the production publish gate.
Default tests mock the provider so CI never spends quota.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from agents.character_policy import compile_character_policy  # noqa: E402
from agents.director import DirectorAgent  # noqa: E402
from agents.provider import ModelResult  # noqa: E402

PROBES_DIR = Path(__file__).resolve().parent / "policy_probes"


@dataclass
class ProbeResult:
    probe_id: str
    play_mode: str
    ok: bool
    published_text: str
    errors: list[str] = field(default_factory=list)
    policy_version: str = ""


def load_probes(directory: Path | None = None) -> list[dict[str, Any]]:
    root = directory or PROBES_DIR
    cases: list[dict[str, Any]] = []
    if not root.is_dir():
        return cases
    for path in sorted(root.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            cases.append(data)
    return cases


def _score_text(probe: dict[str, Any], text: str) -> list[str]:
    errors: list[str] = []
    low = (text or "").lower()
    for banned in probe.get("forbidden_substrings") or []:
        if banned and banned.lower() in low:
            errors.append(f"forbidden:{banned}")
    accept = [a.lower() for a in (probe.get("accept_if_any") or []) if a]
    if accept and not any(a in low for a in accept):
        errors.append("missing_policy_signal")
    if not (text or "").strip():
        errors.append("empty_publish")
    return errors


def _mock_line(probe: dict[str, Any], *, good: bool) -> str:
    if good:
        return (
            "The money is not the point. The family still needs a plan, "
            "and you do not get to close this for me."
        )
    return "Fine. I do this because I enjoy it. I liked it."


async def run_probe_on_adapters(
    probe: dict[str, Any],
    *,
    director: DirectorAgent,
    good: bool = True,
) -> list[ProbeResult]:
    """Run one probe through Direct, Crew, and Story with a mocked provider."""
    from unittest.mock import AsyncMock

    line = _mock_line(probe, good=good)
    payload = json.dumps(
        {
            "reply_text": line,
            "emotion_state": "tense",
            "gif_search_query": "walter tense",
            "thinking": "Do not let them close the ledger.",
            "action": {"verb": "idle_tense"},
            "private_goal": "Keep control",
            "fear": "Being finished",
            "relationship_tactic": "reframe",
            "speech_act": "correct",
            "surface_intent": "protect the family story",
            "subtext": "I am not done",
            "tool_executed": None,
            "tool_log": None,
        }
    )
    director.provider.call_model = AsyncMock(return_value=json.dumps([
        {
            "type": "agent_speak",
            "data": {
                "character_id": "Walter White",
                "content": "draft",
                "emotion_state": "tense",
                "gif_search_query": "x",
            },
        }
    ]))
    director.provider.call_model_with_tools = AsyncMock(
        return_value=ModelResult(content=payload, tool_calls=[], stop_reason="end_turn")
    )
    cid = probe.get("character_id", "walter")
    ctx = {
        "mode": "direct",
        "relation": probe.get("relation", "family member"),
        "language": "en",
        "history": [],
        "llmProvider": "stepfun",
        "era": probe.get("era", "s1"),
    }
    policy = compile_character_policy(cid, era=str(probe.get("era") or ""), play_mode="direct")
    out: list[ProbeResult] = []

    direct = await director.handle_chat_message(cid, probe["user_input"], {**ctx, "mode": "direct"})
    d_text = str(direct.get("reply_text") or "")
    out.append(ProbeResult(
        probe_id=str(probe.get("id")),
        play_mode="direct",
        ok=not _score_text(probe, d_text),
        published_text=d_text,
        errors=_score_text(probe, d_text),
        policy_version=str(direct.get("policy_version") or policy.version),
    ))

    crew = await director.handle_chat_message(cid, probe["user_input"], {**ctx, "mode": "crew"})
    logs = crew.get("debate_logs") or []
    c_text = str((logs[0] or {}).get("text") or "") if logs else ""
    out.append(ProbeResult(
        probe_id=str(probe.get("id")),
        play_mode="crew",
        ok=not _score_text(probe, c_text),
        published_text=c_text,
        errors=_score_text(probe, c_text),
        policy_version=str((logs[0] or {}).get("policy_version") or policy.version) if logs else policy.version,
    ))

    collected = []
    async for ev in director._generate_beat(
        task=probe["user_input"],
        outline="1. Kitchen",
        beat_index=0,
        context={"previous_scene": "", "current_scene": "kitchen"},
        language="en",
    ):
        collected.append(ev)
    speaks = [e for e in collected if getattr(e, "type", None) == "agent_speak"]
    s_text = str((speaks[0].data or {}).get("content") or "") if speaks else ""
    out.append(ProbeResult(
        probe_id=str(probe.get("id")),
        play_mode="story",
        ok=not _score_text(probe, s_text),
        published_text=s_text,
        errors=_score_text(probe, s_text),
        policy_version=policy.version,
    ))

    versions = {r.policy_version for r in out if r.policy_version}
    if len(versions) > 1:
        for r in out:
            r.ok = False
            r.errors.append("policy_version_mismatch")
    return out
