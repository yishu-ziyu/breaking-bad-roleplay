"""Hard-rule World Validator (DEC-0005 P2).

Does not score taste. Any ``severity=error`` must block commit or force repair.
Soft issues (warn) are logged for Critic / telemetry.
"""

from __future__ import annotations

import re
from typing import Any

from agents.continuity_board import normalize_character_id
from agents.narrative_contracts import (
    BeatContract,
    TurnProposal,
    ValidationIssue,
    ValidationResult,
)
from scenes.action_ontology import map_action_verb
from scenes.world_mode import WorldMode

# Distinctive multi-word / long fact snippets for knowledge boundary.
_MIN_FACT_SNIPPET = 28


def _fact_texts_hidden_from(board: dict[str, Any] | None, actor_id: str) -> list[str]:
    if not board:
        return []
    cid = normalize_character_id(actor_id)
    hidden_texts: list[str] = []
    for fact in board.get("shared_facts") or []:
        if not isinstance(fact, dict):
            continue
        hidden = [normalize_character_id(x) for x in (fact.get("hidden_from") or [])]
        known_by = [normalize_character_id(x) for x in (fact.get("known_by") or [])]
        text = str(fact.get("text") or "").strip()
        if not text:
            continue
        if cid in hidden:
            hidden_texts.append(text)
            continue
        # Explicit known_by list that excludes this actor (and not empty).
        if known_by and cid not in known_by:
            hidden_texts.append(text)
    return hidden_texts


def _text_claims_fact(utterance: str, fact_text: str) -> bool:
    """Conservative: long lowercase substring of the fact appears in utterance."""
    u = (utterance or "").lower()
    f = (fact_text or "").lower().strip()
    if not u or not f or len(f) < _MIN_FACT_SNIPPET:
        return False
    # Prefer a mid-length window from the fact (avoid matching single names).
    snippet = f
    if len(snippet) > 80:
        snippet = snippet[:80]
    # Drop leading proper-name short clauses.
    if snippet in u:
        return True
    # Token overlap: > 60% of significant tokens from fact appear in utterance.
    tokens = [t for t in re.findall(r"[a-zA-Z\u4e00-\u9fff]{4,}", f) if t not in {
        "that", "this", "with", "from", "have", "been", "will", "their", "about",
    }]
    if len(tokens) < 4:
        return False
    hits = sum(1 for t in tokens if t in u)
    return hits >= max(4, int(len(tokens) * 0.6))


def _dead_or_absent_actors(board: dict[str, Any] | None) -> set[str]:
    """Heuristic: irreversible costs that remove an actor from play."""
    out: set[str] = set()
    if not board:
        return out
    death_re = re.compile(
        r"\b(dead|died|killed|murdered|executed|deceased|死亡|死了|被杀)\b",
        re.I,
    )
    for cost in board.get("irreversible_costs") or []:
        text = cost if isinstance(cost, str) else str(
            (cost or {}).get("text") or cost or ""
        )
        if not death_re.search(text):
            continue
        low = text.lower()
        for name in (
            "walter",
            "jesse",
            "skyler",
            "saul",
            "mike",
            "gus",
            "hank",
        ):
            if name in low:
                out.add(name)
    return out


def validate_world_turn(
    contract: BeatContract,
    turn: TurnProposal,
    *,
    board: dict[str, Any] | None = None,
    world_mode: WorldMode = "alternate",
) -> ValidationResult:
    """Hard + soft world checks for one Turn Proposal.

    Canon: strict cast/knowledge.
    Alternate: knowledge hard; cast warn if off-board but on contract.
    Sandbox: knowledge warn only (still error on empty / dead actor).
    """
    issues: list[ValidationIssue] = []
    actor = normalize_character_id(turn.actor_id)

    # --- presence ---
    present = {normalize_character_id(x) for x in contract.present_characters}
    if actor not in present:
        issues.append(
            ValidationIssue(
                code="actor_not_present",
                message=f"{actor} not in BeatContract.present_characters",
                actor_id=actor,
                severity="error",
            )
        )

    dead = _dead_or_absent_actors(board)
    if actor in dead:
        issues.append(
            ValidationIssue(
                code="actor_removed",
                message=f"{actor} is irreversibly out of play",
                actor_id=actor,
                severity="error",
            )
        )

    if board and board.get("present_cast"):
        cast = {normalize_character_id(x) for x in (board.get("present_cast") or [])}
        if actor and actor not in cast:
            sev = "error" if world_mode == "canon" else "warn"
            issues.append(
                ValidationIssue(
                    code="actor_not_in_room_cast",
                    message=f"{actor} not in Continuity Board present_cast",
                    actor_id=actor,
                    severity=sev,
                )
            )

    # --- empty turn ---
    if not (turn.line or "").strip() and not turn.action:
        issues.append(
            ValidationIssue(
                code="empty_turn",
                message="Turn has neither line nor action",
                actor_id=actor,
                severity="error",
            )
        )

    # --- action ontology ---
    if turn.action and (turn.action.verb or "").strip():
        verb, mapped = map_action_verb(turn.action.verb)
        if mapped and verb == "idle_tense":
            issues.append(
                ValidationIssue(
                    code="action_unmapped",
                    message=f"action verb {turn.action.verb!r} mapped to idle_tense",
                    actor_id=actor,
                    field="action.verb",
                    severity="warn",
                )
            )
        # hand_over requires target in present cast when target set
        if verb == "hand_over" and turn.action.target_id:
            tid = normalize_character_id(turn.action.target_id)
            if tid and tid not in present:
                issues.append(
                    ValidationIssue(
                        code="target_not_present",
                        message=f"hand_over target {tid} not present",
                        actor_id=actor,
                        field="action.target_id",
                        severity="error",
                    )
                )

    # --- knowledge boundary ---
    utterance = " ".join(
        [
            turn.inner_monologue or "",
            turn.line or "",
            " ".join(turn.observed_facts or []),
        ]
    )
    hidden = _fact_texts_hidden_from(board, actor)
    for fact_text in hidden:
        if _text_claims_fact(utterance, fact_text):
            sev = "warn" if world_mode == "sandbox" else "error"
            issues.append(
                ValidationIssue(
                    code="knowledge_boundary",
                    message="Turn claims facts hidden from this actor",
                    actor_id=actor,
                    field="inner_monologue|line",
                    severity=sev,
                )
            )
            break

    # --- forbidden outcomes (contract) phrase match ---
    blob = f"{turn.line or ''} {turn.inner_monologue or ''}".lower()
    for fo in contract.forbidden_outcomes or []:
        fo_s = str(fo).strip().lower()
        if len(fo_s) < 12:
            continue
        # Drop leading character name so "Walter immediately…" matches the act.
        core = re.sub(
            r"^(walter|jesse|skyler|saul|mike|gus|hank)\s+",
            "",
            fo_s,
        )
        keys = {fo_s[:48], core[:48]}
        if any(k and k in blob for k in keys):
            # Contract forbidden_outcomes are hard authorial constraints in all modes.
            issues.append(
                ValidationIssue(
                    code="forbidden_outcome",
                    message=f"Turn hits forbidden_outcome: {fo_s[:80]}",
                    actor_id=actor,
                    severity="error",
                )
            )

    errors = [i for i in issues if i.severity == "error"]
    return ValidationResult(ok=len(errors) == 0, issues=issues)
