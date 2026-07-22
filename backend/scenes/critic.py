"""Narrative Soft Critic (DEC-0005 P3).

Symbolic/heuristic scores — no LLM. Hard failures must be handled by the
World Validator first; this module only ranks *legal* proposals.

Weights (product default):
  intentionality (character policy)  30%
  causal_relevance                   25%
  continuity                         20%
  dramatic_value                     15%
  visual_executability               10%
"""

from __future__ import annotations

import re
from typing import Any

from agents.narrative_contracts import BeatContract, CriticScore, TurnProposal
from scenes.action_ontology import ACTION_VERBS, map_action_verb

# Product weights — hard errors never enter this scorer.
WEIGHTS: dict[str, float] = {
    "intentionality": 0.30,
    "causal_relevance": 0.25,
    "continuity": 0.20,
    "dramatic_value": 0.15,
    "visual_executability": 0.10,
}

_EXPOSITION_RE = re.compile(
    r"\b(as you know|let me explain the plot|the audience should know|"
    r"i will now tell you everything|to summarize the story|"
    r"众所周知|我来解释剧情|剧情是这样)\b",
    re.I,
)
_VOLUME_FIRST_RE = re.compile(
    r"\b(i will destroy|smash this|scream at you|kill you right now|"
    r"我要砸|我现在就杀|大声吼)\b",
    re.I,
)
_TOKEN_RE = re.compile(r"[a-zA-Z\u4e00-\u9fff]{3,}")


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN_RE.findall(text or "")}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def _filled(*parts: str) -> int:
    return sum(1 for p in parts if (p or "").strip())


def score_intentionality(turn: TurnProposal) -> float:
    """Character policy completeness + mind/mouth tension."""
    score = 0.15  # base: has a line
    score += 0.12 * min(1, _filled(turn.private_goal))
    score += 0.10 * min(1, _filled(turn.fear))
    score += 0.12 * min(1, _filled(turn.relationship_tactic))
    score += 0.12 * min(1, _filled(turn.speech_act))
    score += 0.12 * min(1, _filled(turn.subtext))
    score += 0.08 * min(1, _filled(turn.surface_intent))
    score += 0.08 * min(1, _filled(turn.inner_monologue))

    line_t = _tokens(turn.line)
    mono_t = _tokens(turn.inner_monologue)
    if mono_t and line_t:
        sim = _jaccard(mono_t, line_t)
        # Reward tension (not paraphrase); punish near-duplicate monologue.
        if sim < 0.35:
            score += 0.12
        elif sim > 0.75:
            score -= 0.15
        else:
            score += 0.05

    blob = f"{turn.line} {turn.inner_monologue}"
    if _EXPOSITION_RE.search(blob):
        score -= 0.25
    if _VOLUME_FIRST_RE.search(turn.line or "") and not _filled(turn.subtext):
        score -= 0.15

    return _clamp01(score)


def score_causal_relevance(contract: BeatContract, turn: TurnProposal) -> float:
    """Does the turn answer the beat's dramatic pressure?"""
    anchors = " ".join(
        [
            contract.dramatic_question or "",
            contract.pressure_source or "",
            contract.value_before or "",
            contract.value_after or "",
            " ".join(contract.required_outcome or []),
        ]
    )
    anchor_t = _tokens(anchors)
    turn_t = _tokens(
        f"{turn.line} {turn.inner_monologue} {turn.private_goal} "
        f"{' '.join(turn.observed_facts or [])}"
    )
    if not anchor_t:
        return 0.55 if (turn.line or "").strip() else 0.2
    overlap = _jaccard(anchor_t, turn_t)
    score = 0.25 + 0.75 * min(1.0, overlap * 3.0)  # modest overlap is enough
    if turn.speech_act in {"probe", "bargain", "implied_threat", "correct", "deflect"}:
        score += 0.08
    if not (turn.line or "").strip():
        score -= 0.3
    return _clamp01(score)


def score_continuity(turn: TurnProposal, board: dict[str, Any] | None = None) -> float:
    """Room memory discipline + non-repetition."""
    score = 0.35
    if turn.observed_facts:
        score += min(0.25, 0.08 * len(turn.observed_facts))
    else:
        score -= 0.12

    line_t = _tokens(turn.line)
    mono_t = _tokens(turn.inner_monologue)
    if mono_t and line_t and _jaccard(mono_t, line_t) > 0.8:
        score -= 0.2

    # Prefer referencing board location lightly (no hard fail).
    if board and board.get("location"):
        loc = str(board.get("location") or "").lower()
        if loc and loc.split()[0] in (turn.line or "").lower():
            score += 0.05

    if turn.action and turn.action.effects:
        score += 0.08

    return _clamp01(score)


def score_dramatic_value(contract: BeatContract, turn: TurnProposal) -> float:
    """Tension / value-turn potential (soft)."""
    score = 0.4
    emo = (turn.emotion_state or "").lower()
    role = (contract.dramatic_role or "").lower()
    high_roles = {"crisis", "climax", "inciting"}
    tense_emos = {"tense", "angry", "fearful", "manipulative", "desperate", "guilty"}

    if emo in tense_emos:
        score += 0.2
    if role in high_roles and emo in tense_emos:
        score += 0.12
    if role in high_roles and emo == "calm" and turn.speech_act not in {
        "correct",
        "implied_threat",
        "probe",
    }:
        score -= 0.15

    line = (turn.line or "").strip()
    if 8 <= len(line) <= 280:
        score += 0.1
    elif len(line) < 4:
        score -= 0.25

    if _filled(turn.subtext) and _filled(turn.surface_intent):
        # Surface ≠ subtext is classic value pressure.
        if _jaccard(_tokens(turn.subtext), _tokens(turn.surface_intent)) < 0.5:
            score += 0.12

    if _VOLUME_FIRST_RE.search(line):
        score -= 0.1

    return _clamp01(score)


def score_visual_executability(turn: TurnProposal) -> float:
    """Can Stage Compiler / CueRunner run this action?"""
    if not turn.action or not (turn.action.verb or "").strip():
        return 0.25  # speak-only still stageable as idle + talk
    verb, mapped = map_action_verb(turn.action.verb)
    score = 0.55 if verb in ACTION_VERBS else 0.2
    if mapped and verb == "idle_tense":
        score -= 0.15
    if verb in {"walk_to", "look_at", "turn_to", "hand_over"}:
        if turn.action.target_id or turn.action.destination_anchor:
            score += 0.25
        else:
            score -= 0.1
    if turn.action.destination_anchor:
        score += 0.1
    if turn.action.animation:
        score += 0.05
    if verb == "idle_tense" and not (turn.line or "").strip():
        score -= 0.2
    return _clamp01(score)


def score_turn(
    contract: BeatContract,
    turn: TurnProposal,
    *,
    board: dict[str, Any] | None = None,
) -> CriticScore:
    """Return weighted soft scores for one Turn Proposal."""
    intentionality = score_intentionality(turn)
    causal = score_causal_relevance(contract, turn)
    continuity = score_continuity(turn, board)
    dramatic = score_dramatic_value(contract, turn)
    visual = score_visual_executability(turn)

    # Legacy aliases for existing CriticScore fields / UI.
    voice_fit = intentionality
    tension = dramatic
    knowledge_discipline = continuity
    worth_staging = 0.5 * visual + 0.5 * causal

    weighted = (
        intentionality * WEIGHTS["intentionality"]
        + causal * WEIGHTS["causal_relevance"]
        + continuity * WEIGHTS["continuity"]
        + dramatic * WEIGHTS["dramatic_value"]
        + visual * WEIGHTS["visual_executability"]
    )

    notes_parts = []
    if intentionality < 0.4:
        notes_parts.append("weak character strategy fields")
    if causal < 0.4:
        notes_parts.append("low beat causal relevance")
    if visual < 0.4:
        notes_parts.append("action hard to stage")
    if intentionality >= 0.7 and dramatic >= 0.6:
        notes_parts.append("strong policy + pressure")

    return CriticScore(
        intentionality=intentionality,
        causal_relevance=causal,
        continuity=continuity,
        dramatic_value=dramatic,
        visual_executability=visual,
        voice_fit=voice_fit,
        tension=tension,
        knowledge_discipline=knowledge_discipline,
        worth_staging=worth_staging,
        weighted_total=round(weighted, 4),
        notes="; ".join(notes_parts),
    )


def prefer_turn(
    contract: BeatContract,
    turn_a: TurnProposal,
    turn_b: TurnProposal,
    *,
    board: dict[str, Any] | None = None,
) -> str:
    """Return 'a' or 'b' by weighted soft score (ties → a)."""
    sa = score_turn(contract, turn_a, board=board)
    sb = score_turn(contract, turn_b, board=board)
    return "a" if sa.weighted_total >= sb.weighted_total else "b"
