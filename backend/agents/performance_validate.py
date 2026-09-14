"""Hard checks so a performance line cannot rewrite the settled night."""

from __future__ import annotations

import re
from typing import Any

from agents.narrative_contracts import (
    BeatContract,
    TurnProposal,
    backend_to_actor_id,
    validate_turn_against_contract_basic,
)
from agents.turn_acceptance import should_publish_turn
from game.performance_types import PerformanceRequest
from scenes.validator import validate_world_turn

_RESOURCE_AWARD = re.compile(
    r"(现金|cash|人情|saul_favor).{0,8}(到账|奖励|给你|\+|回来)|"
    r"给你.{0,4}(钱|现金)",
    re.I,
)
_INVENTED_EVENT = re.compile(
    r"汉克.{0,12}(破门|搜查|逮捕)|"
    r"\bDEA\b|"
    r"搜查令|"
    r"古斯.{0,6}(死了|被杀)",
)
_COMMITMENT = re.compile(
    r"(我|你|沃尔特|他|她)\s*(现在)?(答应|保证|承诺)([^。！？\n]{0,24})"
)

RULE_KEYS = ("resources", "meters", "promises", "flags")


def actor_id(raw: str | None) -> str:
    return backend_to_actor_id(raw) or (raw or "").strip().lower()


def parse_performance_payload(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    if text.startswith("{") or text.startswith("["):
        import json

        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("format") from exc
        if not isinstance(data, dict):
            raise ValueError("format")
        return data
    if not text:
        raise ValueError("format")
    return {"line": text}


def invents_walter_commitment(text: str, request: PerformanceRequest) -> bool:
    if not request.player_is_walter:
        return False
    for match in _COMMITMENT.finditer(text or ""):
        clause = match.group(0)
        if "不回家" in clause:
            return True
        if any(_restates_open_promise(clause, label) for label in request.open_promises):
            continue
        if _restates_open_promise(clause, request.player_confirmed_intent):
            continue
        return True
    return False


def _restates_open_promise(clause: str, allowed: str) -> bool:
    if not allowed:
        return False
    keys = re.findall(r"[\u4e00-\u9fff]{2,}", allowed)
    if len(keys) < 2:
        return allowed in clause
    hits = sum(1 for key in keys if key in clause)
    return hits >= 2


def validate_performance_payload(
    payload: dict[str, Any],
    request: PerformanceRequest,
) -> list[str]:
    issues: list[str] = []
    for key in RULE_KEYS:
        value = payload.get(key)
        if value not in (None, {}, [], 0, ""):
            issues.append(f"payload_{key}")
    if "revision" in payload and payload["revision"] is not None:
        issues.append("revision")

    line = str(payload.get("line") or "").strip()
    speaker = actor_id(payload.get("speaker") or request.speaker)
    if _RESOURCE_AWARD.search(line):
        issues.append("resource_award")
    if invents_walter_commitment(line, request):
        issues.append("walter_commitment")
    if _INVENTED_EVENT.search(line):
        issues.append("invented_event")

    if not line:
        issues.append("empty")
        return issues

    contract = BeatContract(
        beat_id=f"perf-{request.revision}",
        dramatic_role="progressive",
        location_id=request.location or "unknown",
        present_characters=list(request.present_characters) or [speaker, "walter"],
        value_before="settled",
        value_after="voiced",
        dramatic_question="voice the committed beat",
        pressure_source=request.settled_consequence or request.fallback_line,
        required_outcome=[],
        forbidden_outcomes=[],
    )
    turn = TurnProposal(
        actor_id=speaker,
        line=line,
        observed_facts=list(request.visible_facts),
    )
    board = {
        "present_cast": list(request.present_characters) or [speaker],
        "shared_facts": _board_facts(request, speaker),
        "irreversible_costs": [],
    }
    basic = validate_turn_against_contract_basic(contract, turn)
    world = validate_world_turn(contract, turn, board=board, world_mode="alternate")
    if not should_publish_turn(basic, world):
        codes = [i.code for i in (*basic.issues, *world.issues) if i.severity == "error"]
        issues.append("world_or_character:" + ",".join(codes) if codes else "world_or_character")
    return issues


def _board_facts(request: PerformanceRequest, speaker: str) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    for index, text in enumerate(request.visible_facts):
        facts.append(
            {
                "id": f"vis-{index}",
                "text": text,
                "known_by": [speaker],
                "hidden_from": [],
            }
        )
    for index, text in enumerate(request.hidden_facts):
        facts.append(
            {
                "id": f"hid-{index}",
                "text": text,
                "known_by": [],
                "hidden_from": [speaker],
            }
        )
    return facts
