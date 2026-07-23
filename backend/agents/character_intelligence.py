"""Era-bound Character Intelligence Pack loader (S1 Walter v1).

Loads decision rules / identity / forbidden / scene DNA from
materials/breaking-bad/intelligence/{era_family}/{character}/.

Not Continuity Board facts. Not community dumps.
"""

from __future__ import annotations

from pathlib import Path

from agents.continuity_board import normalize_character_id

# Core files first; scene DNA after (capped).
_CORE_FILES = (
    "identity_era.md",
    "decision_rules.md",
    "forbidden.md",
)
_MAX_SCENE_DNA = 6
_DEFAULT_MAX_CHARS = 6500


def intelligence_root() -> Path:
    """materials/breaking-bad/intelligence relative to repo root."""
    here = Path(__file__).resolve()
    repo = here.parents[2]
    return repo / "materials" / "breaking-bad" / "intelligence"


def era_family(era: str | None) -> str | None:
    """Map board era id to pack family directory name, or None if no pack."""
    if not era:
        return None
    key = era.strip().lower()
    if key.startswith("s1"):
        return "s1"
    # Later: s2, s3, s4, s5 families when packs exist.
    return None


def pack_dir(character_id: str | None, era: str | None) -> Path | None:
    family = era_family(era)
    if not family:
        return None
    cid = normalize_character_id(character_id)
    if not cid:
        return None
    path = intelligence_root() / family / cid
    return path if path.is_dir() else None


def load_intelligence_body(
    character_id: str | None,
    era: str | None,
    *,
    max_scene_dna: int = _MAX_SCENE_DNA,
) -> str:
    """Return concatenated markdown for the pack, or empty string."""
    root = pack_dir(character_id, era)
    if root is None:
        return ""

    parts: list[str] = []
    for name in _CORE_FILES:
        path = root / name
        if path.is_file():
            text = path.read_text(encoding="utf-8").strip()
            if text:
                parts.append(text)

    dna = root / "scene_dna"
    if dna.is_dir():
        files = sorted(dna.glob("*.md"))[: max(0, max_scene_dna)]
        for path in files:
            text = path.read_text(encoding="utf-8").strip()
            if text:
                parts.append(text)

    return "\n\n".join(parts).strip()


def format_intelligence_prompt_block(
    character_id: str | None,
    era: str | None,
    *,
    max_chars: int = _DEFAULT_MAX_CHARS,
) -> str:
    """Prompt block for Character Policy injection, or empty if no pack."""
    body = load_intelligence_body(character_id, era)
    if not body:
        return ""

    family = era_family(era) or "?"
    cid = normalize_character_id(character_id) or "unknown"
    if len(body) > max_chars:
        body = body[: max_chars - 20].rstrip() + "\n…[truncated]"

    return (
        "CHARACTER INTELLIGENCE PACK "
        f"(era_family={family}, character={cid}, board_era={era or 'unset'}):\n"
        "These are decision rules and era-local forbidden behaviors. "
        "They are not audience wiki and not Continuity Board facts.\n"
        "Obey era bounds: do not bleed later-season identity into this mouth.\n\n"
        f"{body}"
    )
