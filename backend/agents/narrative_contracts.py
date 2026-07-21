"""Narrative pipeline contracts: Beat Contract + Turn Proposal.

See docs/decisions/DEC-0005-propose-validate-commit-narrative.md.

These models are the symbolic boundary between LLM creativity and committed
story state. P0: schema. P1: Director emits BeatContract; Character path
emits TurnProposal and maps to SSE via turn_to_sse_events.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

DramaticRole = Literal[
    "setup",
    "inciting",
    "progressive",
    "crisis",
    "climax",
    "resolution",
]

# Frontend short ids (canonical for contracts).
ActorId = str

# Backend full name → contract actor_id (and reverse).
BACKEND_TO_ACTOR_ID: dict[str, str] = {
    "Walter White": "walter",
    "Jesse Pinkman": "jesse",
    "Skyler White": "skyler",
    "Saul Goodman": "saul",
    "Mike Ehrmantraut": "mike",
    "Gus Fring": "gus",
    "Hank Schrader": "hank",
}
ACTOR_ID_TO_BACKEND: dict[str, str] = {v: k for k, v in BACKEND_TO_ACTOR_ID.items()}

_DRAMATIC_ROLES = frozenset(
    {"setup", "inciting", "progressive", "crisis", "climax", "resolution"}
)


def backend_to_actor_id(backend_id: str | None) -> str:
    if not backend_id:
        return ""
    s = str(backend_id).strip()
    if s in BACKEND_TO_ACTOR_ID:
        return BACKEND_TO_ACTOR_ID[s]
    low = s.lower()
    if low in ACTOR_ID_TO_BACKEND:
        return low
    token = low.split()[0]
    if token in ACTOR_ID_TO_BACKEND:
        return token
    return re.sub(r"[^a-z0-9]+", "_", low).strip("_") or low


def actor_id_to_backend(actor_id: str | None) -> str:
    if not actor_id:
        return "Walter White"
    low = str(actor_id).strip().lower()
    return ACTOR_ID_TO_BACKEND.get(low) or ACTOR_ID_TO_BACKEND.get(
        low.split()[0], "Walter White"
    )


def _coerce_dramatic_role(raw: str | None, fallback: str = "progressive") -> str:
    r = (raw or "").strip().lower()
    if r in _DRAMATIC_ROLES:
        return r
    # McKee tags sometimes arrive as progressive_complication etc.
    for role in (
        "resolution",
        "climax",
        "crisis",
        "inciting",
        "setup",
        "progressive",
    ):
        if role in r:
            return role
    return fallback if fallback in _DRAMATIC_ROLES else "progressive"


class BeatContract(BaseModel):
    """Director output: why this beat exists and what must / must not happen.

    Director does not write final character lines here.
    """

    beat_id: str
    dramatic_role: DramaticRole
    location_id: str
    present_characters: list[ActorId] = Field(min_length=1)
    value_before: str
    value_after: str
    dramatic_question: str
    pressure_source: str
    required_outcome: list[str] = Field(default_factory=list)
    forbidden_outcomes: list[str] = Field(default_factory=list)

    @field_validator("present_characters")
    @classmethod
    def _normalize_ids(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for x in v:
            if not x or not str(x).strip():
                continue
            out.append(backend_to_actor_id(str(x)))
        return out

    @field_validator("dramatic_role", mode="before")
    @classmethod
    def _coerce_role(cls, v: Any) -> str:
        return _coerce_dramatic_role(str(v) if v is not None else None)


class ActionProposal(BaseModel):
    """Structured physical / spatial intent for agent_act mapping."""

    verb: str
    target_id: str | None = None
    destination_anchor: str | None = None
    animation: str | None = None
    preconditions: list[str] = Field(default_factory=list)
    effects: list[str] = Field(default_factory=list)


class TurnProposal(BaseModel):
    """Character Policy output: strategy + realization for one actor in a beat.

    ``inner_monologue`` is diegetic (for the audience), not model chain-of-thought.
    """

    actor_id: ActorId
    observed_facts: list[str] = Field(default_factory=list)
    private_goal: str = ""
    fear: str = ""
    relationship_tactic: str = ""
    action: ActionProposal | None = None
    inner_monologue: str = ""
    speech_act: str = ""
    surface_intent: str = ""
    subtext: str = ""
    line: str = ""
    emotion_state: str = "tense"

    @field_validator("actor_id")
    @classmethod
    def _norm_actor(cls, v: str) -> str:
        return v.strip().lower()


class ValidationIssue(BaseModel):
    """Hard-rule failure from World Validator (P2)."""

    code: str
    message: str
    severity: Literal["error", "warn"] = "error"
    actor_id: ActorId | None = None
    field: str | None = None


class ValidationResult(BaseModel):
    ok: bool
    issues: list[ValidationIssue] = Field(default_factory=list)

    @classmethod
    def success(cls) -> ValidationResult:
        return cls(ok=True, issues=[])

    @classmethod
    def failure(cls, *issues: ValidationIssue) -> ValidationResult:
        return cls(ok=False, issues=list(issues))


class CriticScore(BaseModel):
    """Soft quality scores from Narrative Critic (P3). Higher is better."""

    voice_fit: float = Field(ge=0.0, le=1.0, default=0.5)
    tension: float = Field(ge=0.0, le=1.0, default=0.5)
    knowledge_discipline: float = Field(ge=0.0, le=1.0, default=0.5)
    worth_staging: float = Field(ge=0.0, le=1.0, default=0.5)
    notes: str = ""

    @property
    def total(self) -> float:
        return (
            self.voice_fit
            + self.tension
            + self.knowledge_discipline
            + self.worth_staging
        ) / 4.0


# ---------------------------------------------------------------------------
# Transitional mappers → current SSE event dicts
# ---------------------------------------------------------------------------

EMOTION_ALLOWED = frozenset(
    {
        "calm",
        "tense",
        "angry",
        "fearful",
        "manipulative",
        "guilty",
        "resigned",
        "desperate",
    }
)


def turn_to_sse_events(
    turn: TurnProposal,
    *,
    backend_character_id: str,
    recommended_model: str | None = None,
) -> list[dict[str, Any]]:
    """Map a Turn Proposal into legacy agent_* event dicts (order: think → act → speak)."""
    out: list[dict[str, Any]] = []
    base_meta: dict[str, Any] = {}
    if recommended_model:
        base_meta["recommended_model"] = recommended_model

    mono = (turn.inner_monologue or "").strip()
    if mono:
        out.append(
            {
                "type": "agent_think",
                **base_meta,
                "data": {
                    "character_id": backend_character_id,
                    "thought_content": mono,
                },
            }
        )

    if turn.action and (turn.action.verb or "").strip():
        act = turn.action
        action_text = act.verb
        if act.target_id:
            action_text = f"{act.verb} → {act.target_id}"
        if act.destination_anchor:
            action_text = f"{action_text} ({act.destination_anchor})"
        out.append(
            {
                "type": "agent_act",
                **base_meta,
                "data": {
                    "character_id": backend_character_id,
                    "action": action_text,
                    "target": act.target_id,
                },
            }
        )

    line = (turn.line or "").strip()
    if line:
        emotion = turn.emotion_state if turn.emotion_state in EMOTION_ALLOWED else "tense"
        out.append(
            {
                "type": "agent_speak",
                **base_meta,
                "data": {
                    "character_id": backend_character_id,
                    "content": line,
                    "emotion_state": emotion,
                    "gif_search_query": f"{turn.actor_id} {emotion}",
                    # Strategy metadata for later critic / UI (ignored by old clients).
                    "speech_act": turn.speech_act or None,
                    "surface_intent": turn.surface_intent or None,
                    "subtext": turn.subtext or None,
                    "relationship_tactic": turn.relationship_tactic or None,
                },
            }
        )
    return out


def validate_turn_against_contract_basic(
    contract: BeatContract,
    turn: TurnProposal,
) -> ValidationResult:
    """P0/P2-lite hard checks (no LLM). Expand in World Validator P2."""
    issues: list[ValidationIssue] = []
    if turn.actor_id not in contract.present_characters:
        issues.append(
            ValidationIssue(
                code="actor_not_present",
                message=f"{turn.actor_id} not in present_characters",
                actor_id=turn.actor_id,
            )
        )
    if not (turn.line or "").strip() and not turn.action:
        issues.append(
            ValidationIssue(
                code="empty_turn",
                message="Turn has neither line nor action",
                actor_id=turn.actor_id,
            )
        )
    # Knowledge: observed_facts should not be empty when speaking with subtext claims
    # (soft warn only).
    if (turn.line or "").strip() and not turn.observed_facts:
        issues.append(
            ValidationIssue(
                code="no_observed_facts",
                message="Speaking without declared observed_facts",
                severity="warn",
                actor_id=turn.actor_id,
            )
        )
    errors = [i for i in issues if i.severity == "error"]
    return ValidationResult(ok=len(errors) == 0, issues=issues)


# ---------------------------------------------------------------------------
# P1 parse / synthesize / character → Turn Proposal
# ---------------------------------------------------------------------------


def try_parse_beat_contract(raw: Any) -> BeatContract | None:
    """Validate a dict (or BeatContract) into BeatContract; None on failure."""
    if raw is None:
        return None
    if isinstance(raw, BeatContract):
        return raw
    if not isinstance(raw, dict):
        return None
    data = dict(raw)
    # Aliases LLMs invent
    if "beat_id" not in data and "id" in data:
        data["beat_id"] = data["id"]
    if "location_id" not in data:
        data["location_id"] = (
            data.get("location")
            or data.get("scene")
            or data.get("to_scene")
            or "unknown"
        )
    if "present_characters" not in data:
        cast = data.get("cast") or data.get("characters") or data.get("present")
        if isinstance(cast, list):
            data["present_characters"] = cast
    for key, default in (
        ("value_before", ""),
        ("value_after", ""),
        ("dramatic_question", ""),
        ("pressure_source", ""),
    ):
        if key not in data or data[key] is None:
            data[key] = default
    if not data.get("beat_id"):
        data["beat_id"] = "beat"
    if not data.get("present_characters"):
        return None
    try:
        return BeatContract.model_validate(data)
    except Exception as exc:
        logger.debug("try_parse_beat_contract failed: %s", exc)
        return None


def synthesize_beat_contract(
    *,
    beat_index: int,
    scene_desc: str,
    location_id: str,
    dramatic_role: str,
    events: list[dict[str, Any]],
    active_backend_id: str | None = None,
) -> BeatContract:
    """Build a contract from legacy director events when LLM omitted one."""
    present: list[str] = []
    seen: set[str] = set()
    for evt in events:
        data = evt.get("data") if isinstance(evt.get("data"), dict) else {}
        cid = data.get("character_id")
        if not cid:
            continue
        aid = backend_to_actor_id(str(cid))
        if aid and aid not in seen:
            seen.add(aid)
            present.append(aid)
    if active_backend_id:
        aid = backend_to_actor_id(active_backend_id)
        if aid and aid not in seen:
            present.insert(0, aid)
    if not present:
        present = ["walter"]

    # Prefer player-facing scene text without craft scaffolding.
    hook = (scene_desc or "").strip()
    # Truncate long craft lines.
    if len(hook) > 160:
        hook = hook[:157] + "..."
    role = _coerce_dramatic_role(dramatic_role)
    return BeatContract(
        beat_id=f"beat_{beat_index + 1:02d}",
        dramatic_role=role,  # type: ignore[arg-type]
        location_id=(location_id or "unknown").strip() or "unknown",
        present_characters=present,
        value_before="tension held",
        value_after="pressure advances",
        dramatic_question=hook or "What changes in this beat?",
        pressure_source=hook or "scene pressure",
        required_outcome=[],
        forbidden_outcomes=[
            "character knows facts outside Continuity Board",
            "meta craft labels shown to player",
        ],
    )


def turn_proposal_from_character_result(
    *,
    backend_character_id: str,
    reply_text: str,
    thinking: str | None = None,
    emotion_state: str | None = None,
    director_action: str | None = None,
    observed_facts: list[str] | None = None,
    relationship_tactic: str = "",
    speech_act: str = "",
    surface_intent: str = "",
    subtext: str = "",
) -> TurnProposal:
    """Map Character Agent structured output → Turn Proposal (P1)."""
    actor = backend_to_actor_id(backend_character_id)
    action: ActionProposal | None = None
    act = (director_action or "").strip()
    if act:
        action = ActionProposal(verb=act[:200])
    emo = (emotion_state or "tense").strip().lower()
    if emo not in EMOTION_ALLOWED:
        emo = "tense"
    return TurnProposal(
        actor_id=actor,
        observed_facts=list(observed_facts or []),
        private_goal="",
        fear="",
        relationship_tactic=relationship_tactic,
        action=action,
        inner_monologue=(thinking or "").strip(),
        speech_act=speech_act,
        surface_intent=surface_intent,
        subtext=subtext,
        line=(reply_text or "").strip(),
        emotion_state=emo,
    )


def ensure_actor_on_contract(
    contract: BeatContract,
    backend_character_id: str,
) -> BeatContract:
    """If speaker is missing from cast, add them (Director draft may lag)."""
    aid = backend_to_actor_id(backend_character_id)
    if not aid or aid in contract.present_characters:
        return contract
    chars = list(contract.present_characters) + [aid]
    return contract.model_copy(update={"present_characters": chars})
