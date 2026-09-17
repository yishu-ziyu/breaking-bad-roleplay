"""Keep Direct chat identity: character speaks AS self; player is never the character."""

from __future__ import annotations

import re

# Display names the model must not use as vocatives toward the player.
_SELF_NAMES: dict[str, tuple[str, ...]] = {
    "walter": ("沃尔特", "怀特", "Walter", "Mr. White", "Heisenberg", "海森堡"),
    "jesse": ("杰西", "Jesse", "Pinkman"),
    "skyler": ("天际", "斯凯勒", "Skyler", "Sky"),
    "saul": ("索尔", "Saul", "Goodman", "Jimmy"),
    "mike": ("迈克", "麦克", "Mike", "Ehrmantraut"),
    "gus": ("古斯", "Gus", "Fring", "弗林"),
    "hank": ("汉克", "Hank", "Schrader"),
    "marie": ("玛丽", "Marie"),
}


def normalize_actor(character_id: str | None) -> str:
    raw = (character_id or "").strip().lower()
    aliases = {
        "walter white": "walter",
        "jesse pinkman": "jesse",
        "skyler white": "skyler",
        "saul goodman": "saul",
        "mike ehrmantraut": "mike",
        "gus fring": "gus",
        "hank schrader": "hank",
        "marie schrader": "marie",
    }
    if raw in aliases:
        return aliases[raw]
    return raw.split()[0] if raw else "walter"


def player_identity_block(character_id: str | None, relation: str = "") -> str:
    actor = normalize_actor(character_id)
    names = ", ".join(_SELF_NAMES.get(actor, (actor,)))
    rel = (relation or "acquaintance").strip() or "acquaintance"
    return (
        "PLAYER IDENTITY (hard rule):\n"
        f"- You ARE {actor}. The human player is NOT you and is NOT a copy of your canon life.\n"
        f"- The player's standing this turn: {rel}.\n"
        f"- Never address the player as {names}.\n"
        "- Speak in first person as yourself. Address the player only as 你/you "
        "(or a fitting nickname that is NOT your own name).\n"
        "- Do not write as a third party advising the character; do not role-swap.\n"
        "- Do not project your TV wounds, kill-counts, or episode arcs onto the player.\n"
        "- Only use player body/plot details they actually stated in this chat."
    )


def _vocative_patterns(names: tuple[str, ...]) -> list[re.Pattern[str]]:
    pats: list[re.Pattern[str]] = []
    for name in names:
        esc = re.escape(name)
        # "杰西，…" / "…，杰西，…" / "Jesse —"
        pats.append(re.compile(rf"(^|[，,。！？!?\s]){esc}([，,。！？!?\s]|$)"))
        pats.append(re.compile(rf"^{esc}"))
    return pats


def addresses_player_as_self(text: str, character_id: str | None) -> bool:
    """True when the line likely vocatively calls the player by the character's name."""
    actor = normalize_actor(character_id)
    names = _SELF_NAMES.get(actor)
    if not names or not (text or "").strip():
        return False
    # Allow talking ABOUT self in third person is rare; ban vocative forms.
    for pat in _vocative_patterns(names):
        if pat.search(text):
            return True
    return False
