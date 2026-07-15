"""Continuity Board - shared room memory for Story / Crew roleplay.

Purpose (product):
  Later beats continue from what already happened.
  Each speaker only receives facts they would know.
  This supports brilliance + free play, not a courtroom.

Persistence helper lives here; Director / routes decide when to load/save.
Era seed JSON lives under materials/breaking-bad/continuity/eras/.
"""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

DEFAULT_ERA = "s3_mid"

# Map full display names and short ids onto era-pack ids.
CHARACTER_ID_ALIASES: dict[str, str] = {
    "walter": "walter",
    "walter white": "walter",
    "jesse": "jesse",
    "jesse pinkman": "jesse",
    "skyler": "skyler",
    "skyler white": "skyler",
    "saul": "saul",
    "saul goodman": "saul",
    "mike": "mike",
    "mike ehrmantraut": "mike",
    "gus": "gus",
    "gus fring": "gus",
    "hank": "hank",
    "hank schrader": "hank",
}


def default_era_id() -> str:
    return DEFAULT_ERA


def eras_dir() -> Path:
    """Resolve materials/.../continuity/eras relative to repo root."""
    here = Path(__file__).resolve()
    # backend/agents/continuity_board.py -> repo root
    repo = here.parents[2]
    return repo / "materials" / "breaking-bad" / "continuity" / "eras"


def normalize_character_id(character_id: str | None) -> str:
    if not character_id:
        return ""
    key = character_id.strip().lower()
    return CHARACTER_ID_ALIASES.get(key, key.replace(" ", "_"))


def load_era_pack(era: str = DEFAULT_ERA) -> dict[str, Any]:
    path = eras_dir() / f"{era}.json"
    if not path.is_file():
        # Fall back to default if unknown era requested.
        path = eras_dir() / f"{DEFAULT_ERA}.json"
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"era pack must be an object: {path}")
    return data


def new_session_board(
    *,
    session_id: str,
    era: str = DEFAULT_ERA,
    location: str = "",
    present_cast: list[str] | None = None,
    player_relation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    pack = load_era_pack(era)
    cast = present_cast or list(pack.get("present_cast_default") or [])
    return {
        "session_id": session_id,
        "era": pack.get("era", era),
        "label": pack.get("label"),
        "label_zh": pack.get("label_zh"),
        "location": location,
        "present_cast": cast,
        "shared_facts": deepcopy(pack.get("shared_facts") or []),
        "open_tensions": deepcopy(pack.get("open_tensions") or []),
        "irreversible_costs": deepcopy(pack.get("irreversible_costs") or []),
        "player_relation": player_relation or {},
        "updated_at_beat": 0,
    }


def filter_board_for_character(
    board: dict[str, Any],
    character_id: str,
) -> dict[str, Any]:
    """Return a shallow-copied board view with only facts this speaker knows."""
    cid = normalize_character_id(character_id)
    known: list[dict[str, Any]] = []
    for fact in board.get("shared_facts") or []:
        known_by = [normalize_character_id(x) for x in (fact.get("known_by") or [])]
        hidden = [normalize_character_id(x) for x in (fact.get("hidden_from") or [])]
        if cid in hidden:
            continue
        if cid in known_by or not known_by:
            # empty known_by treated as ambient/public
            known.append(deepcopy(fact))

    tensions: list[dict[str, Any]] = []
    for t in board.get("open_tensions") or []:
        parties = [normalize_character_id(x) for x in (t.get("parties") or [])]
        if not parties or cid in parties:
            tensions.append(deepcopy(t))

    costs = deepcopy(board.get("irreversible_costs") or [])
    return {
        "session_id": board.get("session_id"),
        "era": board.get("era"),
        "location": board.get("location", ""),
        "present_cast": list(board.get("present_cast") or []),
        "shared_facts": known,
        "open_tensions": tensions,
        "irreversible_costs": costs[-2:],
        "player_relation": deepcopy(board.get("player_relation") or {}),
        "updated_at_beat": board.get("updated_at_beat", 0),
    }


def format_board_prompt(
    board_view: dict[str, Any],
    *,
    character_id: str,
) -> str:
    """Build the CONTINUITY BOARD block injected into a character prompt."""
    era = board_view.get("era") or DEFAULT_ERA
    location = board_view.get("location") or "(unspecified)"
    facts = board_view.get("shared_facts") or []
    if facts:
        fact_lines = "\n".join(f"  - {f.get('text', '').strip()}" for f in facts if f.get("text"))
    else:
        fact_lines = "  - (nothing firm on the board for you yet)"

    tensions = board_view.get("open_tensions") or []
    if tensions:
        tension_lines = "\n".join(
            f"  - {t.get('text', '').strip()}" for t in tensions if t.get("text")
        )
    else:
        tension_lines = "  - (none named)"

    costs = board_view.get("irreversible_costs") or []
    if costs:
        cost_lines = "\n".join(
            f"  - {c if isinstance(c, str) else c.get('text', str(c))}" for c in costs
        )
    else:
        cost_lines = "  - (none yet)"

    rel = board_view.get("player_relation") or {}
    rel_line = ""
    if rel:
        rel_line = (
            f"\n- Player relation: to {rel.get('to_character', '?')} "
            f"as {rel.get('relation', '?')}"
        )

    who = character_id or "you"
    return (
        "CONTINUITY BOARD (what this room already established — continue from it):\n"
        f"- Era: {era}\n"
        f"- Location: {location}\n"
        f"- Speaking as: {who}\n"
        f"- You know:\n{fact_lines}\n"
        f"- Live tension involving you:\n{tension_lines}\n"
        f"- Costs already paid (do not pretend these un-happened):\n{cost_lines}"
        f"{rel_line}\n"
        "Play freely inside this setup. Do not invent public facts that contradict it.\n"
        "If the player frames an alternate premise, treat new premises as this session's "
        "direction — then keep later lines consistent with what you already played."
    )


def apply_delta_facts(
    board: dict[str, Any],
    *,
    deltas: list[dict[str, Any]],
    known_by: list[str],
    beat_index: int,
    irreversible: bool = False,
) -> dict[str, Any]:
    """Return a new board with narrative deltas appended as shared_facts."""
    out = deepcopy(board)
    facts = list(out.get("shared_facts") or [])
    knowers = [normalize_character_id(x) for x in known_by if x]
    for i, d in enumerate(deltas or []):
        if not isinstance(d, dict):
            continue
        target = str(d.get("target") or "").strip()
        field = str(d.get("field") or "").strip()
        new_value = str(d.get("new_value") or "").strip()
        if not (target or field or new_value):
            continue
        text = new_value or f"{target}.{field} changed"
        if target and field and new_value:
            text = f"{target}: {field} → {new_value}"
        fact_id = f"beat{beat_index}_{field or 'fact'}_{i}"
        facts.append(
            {
                "id": fact_id,
                "text": text,
                "known_by": knowers or list(out.get("present_cast") or []),
                "hidden_from": [],
                "irreversible": irreversible,
                "source_beat": beat_index,
            }
        )
        if irreversible:
            costs = list(out.get("irreversible_costs") or [])
            costs.append(text)
            out["irreversible_costs"] = costs
    out["shared_facts"] = facts
    out["updated_at_beat"] = beat_index
    return out


def board_to_json(board: dict[str, Any]) -> str:
    return json.dumps(board, ensure_ascii=False)


def board_from_json(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    return data if isinstance(data, dict) else None


# Special dossier row used to persist the board without a schema migration.
BOARD_OWNER_ID = "__continuity__"
BOARD_SUBJECT_ID = "board"


def set_location(board: dict[str, Any], location: str) -> dict[str, Any]:
    out = deepcopy(board)
    if location:
        out["location"] = location
    return out


# ---------------------------------------------------------------------------
# Session persistence (no schema migration: special CharacterDossier row)
# ---------------------------------------------------------------------------

async def load_or_init_session_board(
    session_factory: Any,
    session_id: str,
    *,
    era: str = DEFAULT_ERA,
    location: str = "",
    player_relation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Load board for a session, or seed from era pack and persist."""
    if session_factory is None or not session_id:
        return new_session_board(
            session_id=session_id or "ephemeral",
            era=era,
            location=location,
            player_relation=player_relation,
        )
    from sqlalchemy import select
    from db.models import CharacterDossier

    async with session_factory() as sess:
        stmt = select(CharacterDossier).where(
            CharacterDossier.session_id == session_id,
            CharacterDossier.owner_id == BOARD_OWNER_ID,
            CharacterDossier.subject_id == BOARD_SUBJECT_ID,
        )
        result = await sess.execute(stmt)
        row = result.scalar_one_or_none()
        if row is not None:
            board = board_from_json(row.knowledge)
            if board is not None:
                if location:
                    board = set_location(board, location)
                return board
        board = new_session_board(
            session_id=session_id,
            era=era,
            location=location,
            player_relation=player_relation,
        )
        if row is None:
            row = CharacterDossier(
                session_id=session_id,
                owner_id=BOARD_OWNER_ID,
                subject_id=BOARD_SUBJECT_ID,
                trust_level=5,
                knowledge=board_to_json(board),
                relationship_notes="continuity_board_v0",
            )
            sess.add(row)
        else:
            row.knowledge = board_to_json(board)
        await sess.commit()
        return board


async def save_session_board(
    session_factory: Any,
    session_id: str,
    board: dict[str, Any],
) -> None:
    if session_factory is None or not session_id:
        return
    from sqlalchemy import select
    from db.models import CharacterDossier

    payload = board_to_json(board)
    async with session_factory() as sess:
        stmt = select(CharacterDossier).where(
            CharacterDossier.session_id == session_id,
            CharacterDossier.owner_id == BOARD_OWNER_ID,
            CharacterDossier.subject_id == BOARD_SUBJECT_ID,
        )
        result = await sess.execute(stmt)
        row = result.scalar_one_or_none()
        if row is None:
            sess.add(
                CharacterDossier(
                    session_id=session_id,
                    owner_id=BOARD_OWNER_ID,
                    subject_id=BOARD_SUBJECT_ID,
                    trust_level=5,
                    knowledge=payload,
                    relationship_notes="continuity_board_v0",
                )
            )
        else:
            row.knowledge = payload
        await sess.commit()
