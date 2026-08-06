"""Narrative Soft Critic (DEC-0005 P3).

DramaBench-aligned scoring dimensions (product default):
  character_consistency  25%  — character policy + memory discipline (merged)
  narrative_efficiency   20%  — beat causal relevance
  dramatic_tension       20%  — value-turn potential + polarity flip
  emotional_resonance    15%  — emotional vocabulary & role-appropriate affect
  thematic_depth         10%  — spine / controlling-idea alignment
  format_standards       10%  — action verb validity & structure

Hard gate (before weighted scoring):
  visual_executable      bool — stageability check (rejects unstageable turns)
"""

from __future__ import annotations

import re
from typing import Any

from agents.narrative_contracts import BeatContract, CriticScore, TurnProposal
from scenes.action_ontology import ACTION_VERBS, map_action_verb

# DramaBench-aligned product weights
WEIGHTS: dict[str, float] = {
    "character_consistency": 0.25,
    "narrative_efficiency": 0.20,
    "dramatic_tension": 0.20,
    "emotional_resonance": 0.15,
    "thematic_depth": 0.10,
    "format_standards": 0.10,
}

# Hard gate threshold for visual stageability
VISUAL_GATE_THRESHOLD = 0.30

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
_LATE_WALT_CONFESS_RE = re.compile(
    r"\b("
    r"i (did|do) it because i (liked|love) it|"
    r"i am the danger|"
    r"say my name|"
    r"i liked it\.?\s*i (was good|was really good)|"
    r"money (was|is) never (the|enough)|"
    r"我喜欢这样|"
    r"我就是危险|"
    r"说我的名字"
    r")\b",
    re.I,
)
_TOKEN_RE = re.compile(r"[a-zA-Z\u4e00-\u9fff]{3,}")

# Emotional vocabulary for resonance scoring
_EMOTION_WORDS: dict[str, set[str]] = {
    "anger": {"angry", "fury", "rage", "暴怒", "愤怒", "气"},
    "fear": {"fearful", "scared", "terrified", "恐惧", "害怕", "慌"},
    "sadness": {"sad", "grief", "loss", "悲哀", "悲伤", "失落"},
    "trust": {"trust", "loyal", "faith", "信任", "忠诚", "相信"},
    "disgust": {"disgust", "contempt", "厌恶", "鄙视", "恶心"},
    "surprise": {"surprise", "shock", "stun", "震惊", "惊讶", "意外"},
    "guilt": {"guilty", "shame", "regret", "内疚", "羞愧", "后悔"},
    "hope": {"hope", "wish", "desire", "希望", "愿望", "渴望"},
}
_THEMATIC_WORDS: set[str] = {
    "justice", "family", "loyalty", "betrayal", "power", "control",
    "survival", "truth", "lie", "money", "freedom", "pride", "ego",
    "fear", "love", "hate", "revenge", "sacrifice", "redemption",
    "道德", "正义", "家庭", "忠诚", "背叛", "权力", "控制",
    "生存", "真相", "谎言", "钱", "自由", "骄傲", "复仇",
    "牺牲", "救赎",
}


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


def score_character_consistency(
    turn: TurnProposal,
    board: dict[str, Any] | None = None,
) -> float:
    """Character policy completeness + memory discipline (merged intentionality + continuity).

    Rewards: rich policy fields, mind/mouth tension, observed facts, location anchoring.
    Penalizes: exposition, volume-first, S5 voice bleed in S1.
    """
    # --- Policy completeness (from intentionality) ---
    score = 0.15  # base: has a line
    score += 0.08 * min(1, _filled(turn.private_goal))
    score += 0.07 * min(1, _filled(turn.fear))
    score += 0.08 * min(1, _filled(turn.relationship_tactic))
    score += 0.08 * min(1, _filled(turn.speech_act))
    score += 0.08 * min(1, _filled(turn.subtext))
    score += 0.05 * min(1, _filled(turn.surface_intent))
    score += 0.05 * min(1, _filled(turn.inner_monologue))

    # Mind/mouth tension (reward gap, penalize paraphrase)
    line_t = _tokens(turn.line)
    mono_t = _tokens(turn.inner_monologue)
    if mono_t and line_t:
        sim = _jaccard(mono_t, line_t)
        if sim < 0.35:
            score += 0.08
        elif sim > 0.75:
            score -= 0.10
        else:
            score += 0.03

    # --- Memory discipline (from continuity) ---
    score += 0.08  # base continuity
    if turn.observed_facts:
        score += min(0.15, 0.05 * len(turn.observed_facts))
    else:
        score -= 0.08

    # Monologue not just paraphrasing line
    if mono_t and line_t and _jaccard(mono_t, line_t) > 0.8:
        score -= 0.12

    # Location anchoring
    if board and board.get("location"):
        loc = str(board.get("location") or "").lower()
        if loc and loc.split()[0] in (turn.line or "").lower():
            score += 0.03

    # Action effects
    if turn.action and turn.action.effects:
        score += 0.05

    # --- Penalties ---
    blob = f"{turn.line} {turn.inner_monologue}"
    if _EXPOSITION_RE.search(blob):
        score -= 0.20
    if _VOLUME_FIRST_RE.search(turn.line or "") and not _filled(turn.subtext):
        score -= 0.10

    # S1 mouth must not bleed S5 confession / myth voice
    era = str((board or {}).get("era") or "").lower()
    actor = (turn.actor_id or "").lower()
    if era.startswith("s1") and "walter" in actor:
        if _LATE_WALT_CONFESS_RE.search(turn.line or "") or _LATE_WALT_CONFESS_RE.search(
            turn.inner_monologue or ""
        ):
            score -= 0.35
        if _LATE_WALT_CONFESS_RE.search(turn.line or ""):
            score -= 0.25

    return _clamp01(score)


def score_narrative_efficiency(contract: BeatContract, turn: TurnProposal) -> float:
    """Does the turn answer the beat's dramatic pressure? (was causal_relevance)."""
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
    score = 0.25 + 0.75 * min(1.0, overlap * 3.0)
    if turn.speech_act in {"probe", "bargain", "implied_threat", "correct", "deflect"}:
        score += 0.08
    if not (turn.line or "").strip():
        score -= 0.3
    return _clamp01(score)


def score_dramatic_tension(
    contract: BeatContract,
    turn: TurnProposal,
    *,
    board: dict[str, Any] | None = None,
) -> float:
    """Tension / value-turn potential + polarity flip detection (was dramatic_value, enhanced).

    Now also detects value-charge polarity: is the turn's ending polarity
    flipped from the beat's starting value?
    """
    score = 0.35  # base

    # --- Emotion-state / role alignment ---
    emo = (turn.emotion_state or "").lower()
    role = (contract.dramatic_role or "").lower()
    high_roles = {"crisis", "climax", "inciting"}
    tense_emos = {"tense", "angry", "fearful", "manipulative", "desperate", "guilty"}

    if emo in tense_emos:
        score += 0.15
    if role in high_roles and emo in tense_emos:
        score += 0.10
    if role in high_roles and emo == "calm" and turn.speech_act not in {
        "correct",
        "implied_threat",
        "probe",
    }:
        score -= 0.12

    # --- Line length appropriateness ---
    line = (turn.line or "").strip()
    if 8 <= len(line) <= 280:
        score += 0.08
    elif len(line) < 4:
        score -= 0.20

    # --- Value-turn potential: subtext vs surface_intent tension ---
    if _filled(turn.subtext) and _filled(turn.surface_intent):
        if _jaccard(_tokens(turn.subtext), _tokens(turn.surface_intent)) < 0.5:
            score += 0.10

    # --- Value-charge polarity detection (new) ---
    # Check if the turn's value_before→value_after flips polarity
    val_before = (contract.value_before or "").lower()
    val_after = (contract.value_after or "").lower()
    if val_before and val_after:
        # Simple token-based polarity guess
        neg_before = sum(1 for w in _NEG_VALUE_TOKENS if w in val_before)
        pos_before = sum(1 for w in _POS_VALUE_TOKENS if w in val_before)
        neg_after = sum(1 for w in _NEG_VALUE_TOKENS if w in val_after)
        pos_after = sum(1 for w in _POS_VALUE_TOKENS if w in val_after)

        pol_before = 1 if pos_before > neg_before else (-1 if neg_before > pos_before else 0)
        pol_after = 1 if pos_after > neg_after else (-1 if neg_after > pos_after else 0)

        if pol_before != 0 and pol_after != 0 and pol_before != pol_after:
            score += 0.12  # polarity flip = high dramatic tension
        elif pol_before != 0 and pol_after != 0 and pol_before == pol_after:
            score -= 0.05  # same polarity = diminishing returns

    # --- Volume-first penalty ---
    if _VOLUME_FIRST_RE.search(line):
        score -= 0.08

    return _clamp01(score)


# Value-polarity tokens reused from mckee_story
_NEG_VALUE_TOKENS = frozenset({
    "unease", "imbalance", "suspicion", "doubt", "betray", "break", "chaos",
    "fear", "guilt", "loss", "ruin", "exposure", "danger", "crisis", "dilemma",
    "不安", "失衡", "怀疑", "背叛", "决裂", "混乱", "恐惧", "内疚",
    "崩", "暴露", "危险", "两难", "废墟", "绝望",
})
_POS_VALUE_TOKENS = frozenset({
    "safety", "order", "trust", "loyalty", "hope", "control", "truth",
    "family", "relief", "balance", "win", "secure",
    "安全", "秩序", "信任", "忠诚", "希望", "控制", "真相",
    "家庭", "释然", "平衡", "胜",
})


def score_emotional_resonance(
    contract: BeatContract,
    turn: TurnProposal,
) -> float:
    """Emotional vocabulary diversity & beat-role-appropriate affect (new).

    Rewards: emotional word variety, emotion_state matching dramatic role,
    emotional arc between inner_monologue and line.
    """
    score = 0.30  # base

    # --- Emotional vocabulary count ---
    blob = f"{turn.line} {turn.inner_monologue} {turn.private_goal} {turn.fear}"
    blob_lower = blob.lower()
    found_categories = set()
    total_emo_hits = 0
    for cat, words in _EMOTION_WORDS.items():
        hits = sum(1 for w in words if w in blob_lower)
        if hits > 0:
            found_categories.add(cat)
            total_emo_hits += hits

    # Reward diversity of emotional categories
    score += 0.08 * min(1.0, len(found_categories) / 3.0)
    # Reward density
    score += 0.04 * min(1.0, total_emo_hits / 5.0)

    # --- Emotion state aligns with beat role ---
    emo = (turn.emotion_state or "").lower()
    role = (contract.dramatic_role or "").lower()
    crisis_emotions = {"tense", "angry", "fearful", "desperate", "guilty"}
    resolution_emotions = {"calm", "resigned", "guilty"}
    if role in {"crisis", "climax"} and emo in crisis_emotions:
        score += 0.12
    elif role == "resolution" and emo in resolution_emotions:
        score += 0.10
    elif role in {"setup", "progressive"} and emo in {"tense", "manipulative"}:
        score += 0.06

    # --- Emotional arc: inner_monologue emotion differs from line emotion ---
    # (signals internal conflict → emotional depth)
    line_t = _tokens(turn.line)
    mono_t = _tokens(turn.inner_monologue)
    if mono_t and line_t:
        line_emo = sum(1 for w in _EMOTION_WORDS for ww in _EMOTION_WORDS[w] if ww in line_t)
        mono_emo = sum(1 for w in _EMOTION_WORDS for ww in _EMOTION_WORDS[w] if ww in mono_t)
        if line_emo > 0 and mono_emo > 0 and abs(line_emo - mono_emo) > 0:
            score += 0.08  # emotional tension between thought and speech

    return _clamp01(score)


def score_thematic_depth(
    contract: BeatContract,
    turn: TurnProposal,
) -> float:
    """Spine / controlling-idea alignment (new).

    Checks if the turn's content references the story's core thematic
    vocabulary (value_pair, controlling_idea, etc.).
    """
    score = 0.30  # base

    # Build theme keywords from the contract
    theme_anchors = " ".join([
        contract.value_before or "",
        contract.value_after or "",
        contract.dramatic_question or "",
        contract.pressure_source or "",
    ])
    theme_t = _tokens(theme_anchors) | _THEMATIC_WORDS

    # Check turn content for thematic overlap
    turn_lower = f"{turn.line} {turn.inner_monologue} {turn.private_goal} {turn.fear}".lower()
    turn_t = _tokens(turn_lower)

    overlap = theme_t & turn_t
    if overlap:
        score += 0.15 * min(1.0, len(overlap) / 3.0)

    # Bonus: explicit reference to value_pair or controlling_idea
    if turn.line and any(t in turn.line.lower() for t in _THEMATIC_WORDS):
        score += 0.10

    # Check for moral weight — does the character frame stakes in value terms?
    value_terms = {"right", "wrong", "good", "bad", "should", "must", "owe",
                   "正义", "对", "错", "好", "坏", "应该", "必须", "欠"}
    if any(vt in turn_lower for vt in value_terms):
        score += 0.08

    return _clamp01(score)


def score_format_standards(turn: TurnProposal) -> float:
    """Action verb validity & structural completeness (was part of visual_executability).

    Checks that the turn has a valid action verb or speak-only fallback.
    """
    if not turn.action or not (turn.action.verb or "").strip():
        return 0.40  # speak-only is acceptable
    verb, mapped = map_action_verb(turn.action.verb)
    score = 0.60 if verb in ACTION_VERBS else 0.25
    if mapped and verb == "idle_tense":
        score -= 0.10
    if verb in {"walk_to", "look_at", "turn_to", "hand_over"}:
        if turn.action.target_id or turn.action.destination_anchor:
            score += 0.20
        else:
            score -= 0.08
    if turn.action.destination_anchor:
        score += 0.08
    if turn.action.animation:
        score += 0.04
    if verb == "idle_tense" and not (turn.line or "").strip():
        score -= 0.15
    return _clamp01(score)


def check_visual_gate(turn: TurnProposal) -> bool:
    """Hard gate: is the turn stageable? Returns False if not.

    Rejects turns that are structurally unstageable — no valid action verb
    AND no speakable line, or action verb is completely unmappable.
    """
    has_line = bool((turn.line or "").strip())
    has_action = bool(turn.action and (turn.action.verb or "").strip())

    if not has_line and not has_action:
        return False

    if has_action:
        verb, mapped = map_action_verb(turn.action.verb)
        if not mapped and verb not in ACTION_VERBS and not has_line:
            return False

    return True


def score_turn(
    contract: BeatContract,
    turn: TurnProposal,
    *,
    board: dict[str, Any] | None = None,
) -> CriticScore:
    """Return weighted soft scores for one Turn Proposal.

    If the turn fails the visual gate, ``visual_executable`` will be False
    and the weighted_total will be 0.0 — callers should reject such turns.
    """
    # Hard gate first
    visual_ok = check_visual_gate(turn)

    # DramaBench-aligned dimensions
    cc = score_character_consistency(turn, board)
    ne = score_narrative_efficiency(contract, turn)
    dt = score_dramatic_tension(contract, turn, board=board)
    er = score_emotional_resonance(contract, turn)
    td = score_thematic_depth(contract, turn)
    fs = score_format_standards(turn)

    # Weighted total (only if visual gate passes)
    if visual_ok:
        weighted = (
            cc * WEIGHTS["character_consistency"]
            + ne * WEIGHTS["narrative_efficiency"]
            + dt * WEIGHTS["dramatic_tension"]
            + er * WEIGHTS["emotional_resonance"]
            + td * WEIGHTS["thematic_depth"]
            + fs * WEIGHTS["format_standards"]
        )
    else:
        weighted = 0.0

    # Legacy alias mapping (for backward compat)
    intentionality = cc
    causal_relevance = ne
    continuity = cc  # character_consistency covers both
    dramatic_value = dt
    visual_executability = fs
    voice_fit = cc
    tension = dt
    knowledge_discipline = cc
    worth_staging = 0.5 * fs + 0.5 * ne

    notes_parts = []
    if not visual_ok:
        notes_parts.append("visual gate rejected: unstageable turn")
    if cc < 0.4:
        notes_parts.append("weak character consistency")
    if ne < 0.4:
        notes_parts.append("low narrative efficiency")
    if dt < 0.4:
        notes_parts.append("low dramatic tension")
    if er < 0.3:
        notes_parts.append("weak emotional resonance")
    if td < 0.3:
        notes_parts.append("weak thematic depth")
    if cc >= 0.7 and dt >= 0.6:
        notes_parts.append("strong consistency + tension")

    return CriticScore(
        # DramaBench canonical
        character_consistency=cc,
        narrative_efficiency=ne,
        dramatic_tension=dt,
        emotional_resonance=er,
        thematic_depth=td,
        format_standards=fs,
        visual_executable=visual_ok,
        # Legacy aliases
        intentionality=intentionality,
        causal_relevance=causal_relevance,
        continuity=continuity,
        dramatic_value=dramatic_value,
        visual_executability=visual_executability,
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
    # Hard gate: if one fails, the other wins
    if sa.visual_executable and not sb.visual_executable:
        return "a"
    if sb.visual_executable and not sa.visual_executable:
        return "b"
    return "a" if sa.weighted_total >= sb.weighted_total else "b"