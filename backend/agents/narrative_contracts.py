"""Narrative pipeline contracts: Beat Contract + Turn Proposal.

See docs/decisions/DEC-0005-propose-validate-commit-narrative.md.

These models are the symbolic boundary between LLM creativity and committed
story state. They intentionally do NOT depend on FastAPI or the Director loop
yet — P0 is schema + round-trip only.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

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
        return [x.strip().lower() for x in v if x and str(x).strip()]


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
