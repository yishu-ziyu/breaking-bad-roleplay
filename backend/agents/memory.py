"""
ABQ Roleplay Lab — Agent Memory Layer

Manages the two-tier memory system:
  - World state: character dossiers that persist across sessions
  - Session state: per-session character states and dialogue history

Dossiers are updated at beat_ready time by the Director, driven by LLM
analysis rather than hardcoded rules.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import CharacterDossier, CharacterState, Session

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dossier Delta Computation
# ---------------------------------------------------------------------------

DOSSIER_UPDATE_PROMPT = """\
You are a Breaking Bad relationship analyst.  Given the current dossiers and a
narrative beat, compute how relationships changed.

Respond with ONLY a valid JSON object (no markdown fences, no commentary):

{
  "deltas": [
    {
      "owner": "<character who's perception changed>",
      "subject": "<character being perceived>",
      "trust_delta": <int, -5 to +5>,
      "new_knowledge": "<one sentence: what the owner now knows about the subject>",
      "new_notes": "<one sentence: how the relationship shifted>"
    }
  ]
}

Rules:
- Only include a delta if something actually changed in the beat.
- trust_delta of 0 means no change — omit that entry.
- Be specific: "Walt now knows Jesse bought a gun" not "Jesse bought something".
- If nothing changed, return { "deltas": [] }.
"""


def _extract_json(text: str) -> dict[str, Any]:
    """Pull the first JSON object from a model response."""
    # Try fenced block first
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))
    # Try raw object
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    return {}


async def compute_dossier_delta(
    provider: Any,
    dossiers: dict[str, dict],
    beat_summary: str,
    beat_events: list[dict[str, Any]],
    model_route: str = "minimax/MiniMax-M3",
) -> dict[str, Any]:
    """
    Ask the LLM to analyze what changed in character relationships
    during this beat, return structured deltas.
    """
    dossier_summary = json.dumps(dossiers, ensure_ascii=False, indent=2)
    events_summary = json.dumps(beat_events, ensure_ascii=False, indent=2)

    messages = [
        {"role": "system", "content": DOSSIER_UPDATE_PROMPT},
        {
            "role": "user",
            "content": (
                f"Current dossiers:\n{dossier_summary}\n\n"
                f"Beat summary: {beat_summary}\n\n"
                f"Beat events:\n{events_summary}\n\n"
                "Compute relationship deltas."
            ),
        },
    ]

    try:
        response = await provider.call_model(messages, model_route)
        return _extract_json(response)
    except Exception:
        return {"deltas": []}


# ---------------------------------------------------------------------------
# Dossier Persistence
# ---------------------------------------------------------------------------

def _normalize_character_id(value: Any) -> str:
    """Normalize LLM character names to stable row ids."""
    return str(value or "").strip().lower().replace(" ", "_")


def _load_knowledge(value: str | None) -> dict[str, Any]:
    try:
        loaded = json.loads(value or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _apply_dossier_delta(
    dossier: CharacterDossier,
    trust_delta: int,
    new_knowledge: str,
    new_notes: str,
) -> None:
    dossier.trust_level = max(1, min(10, dossier.trust_level + trust_delta))
    if new_knowledge:
        knowledge = _load_knowledge(dossier.knowledge)
        knowledge[f"beat_{datetime.now(timezone.utc).replace(tzinfo=None).isoformat()}"] = new_knowledge
        dossier.knowledge = json.dumps(knowledge, ensure_ascii=False)
    if new_notes:
        dossier.relationship_notes = (
            dossier.relationship_notes + f"\n[{datetime.now(timezone.utc).replace(tzinfo=None).strftime('%H:%M')}] {new_notes}"
        ).strip()


def _new_dossier(
    session_id: str | None,
    owner: str,
    subject: str,
    trust_delta: int,
    new_knowledge: str,
    new_notes: str,
) -> CharacterDossier:
    return CharacterDossier(
        session_id=session_id,
        owner_id=owner,
        subject_id=subject,
        trust_level=max(1, min(10, 5 + trust_delta)),
        knowledge=json.dumps(
            {"initial": new_knowledge} if new_knowledge else {},
            ensure_ascii=False,
        ),
        relationship_notes=new_notes,
    )


async def update_dossiers(
    db: AsyncSession,
    session_id: str | None,
    beat_summary: str,
    beat_events: list[dict[str, Any]],
    provider: Any,
    model_route: str = "minimax/MiniMax-M3",
) -> list[dict[str, Any]]:
    """
    Load all dossiers for the current session + world-level,
    compute deltas via LLM, persist changes.

    Returns the list of applied deltas for SSE emission.
    """
    # Load session-level dossiers
    stmt = select(CharacterDossier).where(CharacterDossier.session_id == session_id)
    result = await db.execute(stmt)
    session_dossiers = result.scalars().all()

    # Build lookup dict: (owner_id, subject_id) -> session-level dossier
    dossier_map: dict[tuple[str, str], CharacterDossier] = {}
    for d in session_dossiers:
        dossier_map[(d.owner_id, d.subject_id)] = d

    # Load world-level dossiers for context
    world_dossiers: dict[str, dict] = {}
    world_stmt = select(CharacterDossier).where(CharacterDossier.session_id.is_(None))
    world_result = await db.execute(world_stmt)
    world_dossier_map: dict[tuple[str, str], CharacterDossier] = {}
    for d in world_result.scalars().all():
        key = (d.owner_id, d.subject_id)
        world_dossier_map[key] = d
        knowledge = _load_knowledge(d.knowledge)
        world_dossiers[f"{d.owner_id}->{d.subject_id}"] = {
            "trust_level": d.trust_level,
            "knowledge": knowledge,
            "relationship_notes": d.relationship_notes,
        }

    # Compute deltas
    delta_result = await compute_dossier_delta(
        provider=provider,
        dossiers=world_dossiers,
        beat_summary=beat_summary,
        beat_events=beat_events,
        model_route=model_route,
    )

    deltas = delta_result.get("deltas", [])
    applied: list[dict[str, Any]] = []

    for delta in deltas:
        owner = _normalize_character_id(delta.get("owner", ""))
        subject = _normalize_character_id(delta.get("subject", ""))
        trust_delta = delta.get("trust_delta", 0)
        new_knowledge = delta.get("new_knowledge", "")
        new_notes = delta.get("new_notes", "")

        if not owner or not subject or trust_delta == 0:
            continue

        key = (owner, subject)

        # Session-level memory preserves what happened in this playthrough.
        if session_id is not None:
            existing = dossier_map.get(key)
            if existing:
                _apply_dossier_delta(existing, trust_delta, new_knowledge, new_notes)
            else:
                new_dossier = _new_dossier(
                    session_id=session_id,
                    owner=owner,
                    subject=subject,
                    trust_delta=trust_delta,
                    new_knowledge=new_knowledge,
                    new_notes=new_notes,
                )
                db.add(new_dossier)
                dossier_map[key] = new_dossier

        # World-level memory is the cross-session source loaded by new sessions.
        world_existing = world_dossier_map.get(key)
        if world_existing:
            _apply_dossier_delta(world_existing, trust_delta, new_knowledge, new_notes)
        else:
            new_world_dossier = _new_dossier(
                session_id=None,
                owner=owner,
                subject=subject,
                trust_delta=trust_delta,
                new_knowledge=new_knowledge,
                new_notes=new_notes,
            )
            db.add(new_world_dossier)
            world_dossier_map[key] = new_world_dossier

        applied.append({
            "owner": owner,
            "subject": subject,
            "trust_delta": trust_delta,
            "new_knowledge": new_knowledge,
            "world_persisted": True,
            "model_route": model_route,
        })

    await db.commit()
    return applied
