"""Show-wide public cast relations (issue #81).

Facts here must stay true across the series and be checkable against the
show: who is who, how they address each other, who barely knows whom.
Seasonal knowledge (whether Jesse has met Gus yet, who employs whom this
era) belongs on the Continuity Board / era overlay — not here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Canonical short ids for the eight playable characters.
ACTOR_IDS: tuple[str, ...] = (
    "walter",
    "jesse",
    "skyler",
    "saul",
    "mike",
    "gus",
    "hank",
    "marie",
)

DISPLAY_NAME: dict[str, str] = {
    "walter": "Walter White",
    "jesse": "Jesse Pinkman",
    "skyler": "Skyler White",
    "saul": "Saul Goodman",
    "mike": "Mike Ehrmantraut",
    "gus": "Gus Fring",
    "hank": "Hank Schrader",
    "marie": "Marie Schrader",
}

# Mention aliases. No bare "white" (false-positives: white van / powder).
_EN_ALIASES: tuple[tuple[str, str], ...] = (
    (r"\bwalter\b|\bwalt\b|\bheisenberg\b|\bmr\.?\s*white\b", "walter"),
    (r"\bjesse\b|\bpinkman\b", "jesse"),
    (r"\bskyler\b|\bsky\b", "skyler"),
    (r"\bsaul\b|\bgoodman\b", "saul"),
    (r"\bmike\b|\behrmantraut\b", "mike"),
    (r"\bgus\b|\bfring\b", "gus"),
    (r"\bhank\b|\bschrader\b", "hank"),
    (r"\bmarie\b", "marie"),
)
_CJK_ALIASES: tuple[tuple[str, str], ...] = (
    ("沃尔特", "walter"),
    ("海森堡", "walter"),
    ("怀特先生", "walter"),
    ("杰西", "jesse"),
    ("斯凯勒", "skyler"),
    ("索尔", "saul"),
    ("迈克", "mike"),
    ("麦克", "mike"),
    ("古斯", "gus"),
    ("汉克", "hank"),
    ("玛丽", "marie"),
)

_FAMILY = frozenset({"walter", "skyler", "hank", "marie", "jesse"})


@dataclass(frozen=True)
class CastRelation:
    speaker: str
    other: str
    who: str
    address: str
    familiarity: str  # household | family | close | work | adversary | barely


def _r(
    speaker: str,
    other: str,
    who: str,
    address: str,
    familiarity: str,
) -> CastRelation:
    return CastRelation(speaker, other, who, address, familiarity)


# Explicit show-wide rows. Comments cite public series facts, not one-off episodes.
_EXPLICIT: tuple[CastRelation, ...] = (
    # Jesse
    _r(
        "jesse",
        "walter",
        "Former high-school chemistry teacher; later a working partner. Not family. Jesse is not part of the White household.",
        'Mr. White / 怀特先生 — almost never "Walter" / 沃尔特',
        "close",
    ),
    _r(
        "jesse",
        "hank",
        "Hank is Walter White's brother-in-law (married to Marie, Skyler's sister) and a DEA agent who hunts Jesse. Not Jesse's kin. Hank visits the White house — that is not Jesse's house.",
        "Hank / Pinkman's DEA guy — never 'my brother-in-law'",
        "adversary",
    ),
    _r(
        "jesse",
        "skyler",
        "Walter's wife. Not Jesse's family. They are not close; he is not a member of her household.",
        "Mrs. White / Skyler if he must; no family nickname",
        "barely",
    ),
    _r(
        "jesse",
        "marie",
        "Skyler's sister and Hank's wife. Jesse barely knows her. Not family.",
        "Marie if he ever has a name; no kinship term",
        "barely",
    ),
    _r(
        "jesse",
        "saul",
        "Flashy criminal-defense lawyer. No kinship. Do not invent that he is family or a household attorney.",
        "Saul",
        "work",
    ),
    _r(
        "jesse",
        "mike",
        "Older fixer / former-cop type. No kinship. 'Kid' from Mike is tone, not family.",
        "Mike / 麦克",
        "work",
    ),
    _r(
        "jesse",
        "gus",
        "Public face: Los Pollos Hermanos owner. No kinship. Do not invent an employment tie.",
        "Mr. Fring / Gus",
        "barely",
    ),
    # Walter
    _r(
        "walter",
        "jesse",
        "Former student. Not family. Not a White household member.",
        "Jesse (Pinkman when angry)",
        "close",
    ),
    _r(
        "walter",
        "skyler",
        "His wife; mother of their children. The White household is theirs.",
        "Skyler / Sky",
        "household",
    ),
    _r(
        "walter",
        "hank",
        "Brother-in-law: Hank married Marie, Skyler's sister. Hank is DEA and often underestimates Walt. Hank visits the White house as family.",
        "Hank",
        "family",
    ),
    _r(
        "walter",
        "marie",
        "Sister-in-law: Skyler's sister, Hank's wife. Visits as family, not a roommate.",
        "Marie",
        "family",
    ),
    _r(
        "walter",
        "saul",
        "Flashy criminal-defense lawyer. No kinship.",
        "Saul",
        "work",
    ),
    _r(
        "walter",
        "mike",
        "Older fixer. No kinship.",
        "Mike / 麦克",
        "work",
    ),
    _r(
        "walter",
        "gus",
        "Los Pollos Hermanos owner / local businessman. No kinship. Do not invent an always-on employer tie.",
        "Gus / Mr. Fring",
        "work",
    ),
    # Skyler
    _r(
        "skyler",
        "walter",
        "Her husband. The White household is theirs.",
        "Walt",
        "household",
    ),
    _r(
        "skyler",
        "jesse",
        "Walt's former student / the young man around Walt's other life. Not family. Not a member of her household.",
        "Jesse / Pinkman",
        "barely",
    ),
    _r(
        "skyler",
        "hank",
        "Brother-in-law: sister Marie's husband. DEA. Visits their house as family.",
        "Hank",
        "family",
    ),
    _r(
        "skyler",
        "marie",
        "Her sister. Married to Hank.",
        "Marie",
        "family",
    ),
    _r(
        "skyler",
        "saul",
        "Flashy criminal-defense lawyer. Not the family attorney by default. No kinship.",
        "Saul / Mr. Goodman",
        "barely",
    ),
    _r(
        "skyler",
        "mike",
        "No household or family tie. Skyler barely knows him.",
        "Mike / 麦克 if introduced",
        "barely",
    ),
    _r(
        "skyler",
        "gus",
        "Public face: Los Pollos owner. No kinship. Do not invent a family business tie.",
        "Mr. Fring / Gus",
        "barely",
    ),
    # Hank
    _r(
        "hank",
        "walter",
        "Brother-in-law (Hank married Marie; Marie is Skyler's sister). Protective of that family story.",
        "Walt",
        "family",
    ),
    _r(
        "hank",
        "jesse",
        "Street-level DEA target / suspect. Not family. Not a White household member.",
        "Pinkman / Jesse",
        "adversary",
    ),
    _r(
        "hank",
        "skyler",
        "Sister-in-law (wife Marie's sister).",
        "Skyler",
        "family",
    ),
    _r(
        "hank",
        "marie",
        "His wife.",
        "Marie",
        "household",
    ),
    _r(
        "hank",
        "saul",
        "Sleazy TV-ad lawyer. Not family.",
        "Goodman / Saul",
        "work",
    ),
    _r(
        "hank",
        "mike",
        "No family tie. Not a DEA partner.",
        "Mike / 麦克 if he has a name",
        "barely",
    ),
    _r(
        "hank",
        "gus",
        "Los Pollos Hermanos owner / local businessman. Not family.",
        "Gus / Fring",
        "work",
    ),
    # Marie
    _r(
        "marie",
        "walter",
        "Sister-in-law: sister Skyler's husband. Visits the White house as family.",
        "Walt",
        "family",
    ),
    _r(
        "marie",
        "jesse",
        "Barely knows him. Walt's former student / a kid from Walt's other life. Not family. Not in the White or Schrader house.",
        "Jesse if she has a name; no kinship term",
        "barely",
    ),
    _r(
        "marie",
        "skyler",
        "Her sister. Married to Walt.",
        "Skyler",
        "family",
    ),
    _r(
        "marie",
        "hank",
        "Her husband. DEA.",
        "Hank",
        "household",
    ),
    _r(
        "marie",
        "saul",
        "Flashy criminal-defense lawyer with TV ads. Not a family member and not the household attorney. Marie has no personal relationship with him unless this scene establishes one.",
        "Saul / that lawyer if she even has the name",
        "barely",
    ),
    _r(
        "marie",
        "mike",
        "Barely knows him. No kinship.",
        "first name only if introduced",
        "barely",
    ),
    _r(
        "marie",
        "gus",
        "Los Pollos owner / local businessman. No kinship. Barely knows him.",
        "Mr. Fring / Gus if introduced",
        "barely",
    ),
    # Saul — professional, never kin
    _r("saul", "walter", "A client-shaped problem, not family.", "Walt / Mr. White", "work"),
    _r("saul", "jesse", "A client-shaped problem, not family.", "kid / Jesse", "work"),
    _r("saul", "skyler", "Walt's wife. Not Saul's family.", "Skyler / Mrs. White", "work"),
    _r("saul", "hank", "DEA; Walt's brother-in-law. Not Saul's family.", "Hank / Agent Schrader", "adversary"),
    _r("saul", "marie", "Hank's wife, Skyler's sister. Not Saul's family. They barely know each other.", "Marie if introduced", "barely"),
    _r("saul", "mike", "Older fixer. No kinship.", "Mike / 麦克", "work"),
    _r("saul", "gus", "Los Pollos owner. No kinship.", "Mr. Fring / Gus", "work"),
    # Mike — professional
    _r("mike", "walter", "A principal / problem. No kinship.", "Walt", "work"),
    _r("mike", "jesse", "Younger operator. No kinship. 'Kid' is tone, not son.", "kid / Jesse", "work"),
    _r("mike", "skyler", "Walt's wife. No kinship. Barely her world.", "Mrs. White / Skyler", "barely"),
    _r("mike", "hank", "DEA. Walt's brother-in-law. Not Mike's family.", "Schrader / Hank", "adversary"),
    _r("mike", "marie", "Hank's wife. No kinship. Barely knows her.", "Marie if introduced", "barely"),
    _r("mike", "saul", "The lawyer. No kinship.", "Saul", "work"),
    _r("mike", "gus", "Employer-shaped counterpart when the scene says so — not family. Do not invent a household.", "boss / Gus / Mr. Fring", "work"),
    # Gus — formal, never kin
    _r("gus", "walter", "A chemist / associate when the scene says so. No kinship.", "Mr. White / Walter", "work"),
    _r("gus", "jesse", "A young associate when the scene says so. No kinship. Do not invent an employment tie.", "Jesse / Mr. Pinkman", "work"),
    _r("gus", "skyler", "Walter's wife. No kinship.", "Mrs. White / Skyler", "barely"),
    _r("gus", "hank", "DEA; Walter's brother-in-law. Not family.", "Agent Schrader / Hank", "work"),
    _r("gus", "marie", "Hank's wife. No kinship. Barely knows her.", "Mrs. Schrader / Marie", "barely"),
    _r("gus", "saul", "A lawyer. No kinship.", "Mr. Goodman / Saul", "work"),
    _r("gus", "mike", "A trusted operator when the scene says so. No kinship.", "Mike / 麦克", "work"),
)

_PAIR_INDEX: dict[tuple[str, str], CastRelation] = {
    (row.speaker, row.other): row for row in _EXPLICIT
}

_DEFAULT_ADDRESS = {
    "walter": "Walt / Walter",
    "jesse": "Jesse",
    "skyler": "Skyler",
    "saul": "Saul",
    "mike": "Mike / 麦克",
    "gus": "Mr. Fring / Gus",
    "hank": "Hank",
    "marie": "Marie",
}


def _default_row(speaker: str, other: str) -> CastRelation:
    name = DISPLAY_NAME[other]
    return CastRelation(
        speaker=speaker,
        other=other,
        who=f"{name} is not your family and does not live in your house. Do not invent kinship.",
        address=_DEFAULT_ADDRESS[other],
        familiarity="barely",
    )


PAIR_ROWS: tuple[CastRelation, ...] = tuple(
    _PAIR_INDEX.get((speaker, other)) or _default_row(speaker, other)
    for speaker in ACTOR_IDS
    for other in ACTOR_IDS
    if speaker != other
)


def normalize_actor_id(raw: str | None) -> str:
    if not raw:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    low = s.lower()
    if low in ACTOR_IDS:
        return low
    if s in DISPLAY_NAME.values():
        for aid, name in DISPLAY_NAME.items():
            if name == s:
                return aid
    token = low.split()[0]
    if token in ACTOR_IDS:
        return token
    for aid, name in DISPLAY_NAME.items():
        if name.lower() == low:
            return aid
    return ""


def detect_mentioned_ids(text: str) -> list[str]:
    """Return playable ids named in English or Chinese text (stable order)."""
    if not text:
        return []
    found: list[str] = []
    raw = text
    low = raw.lower()
    for alias, aid in _CJK_ALIASES:
        if alias in raw and aid not in found:
            found.append(aid)
    for pattern, aid in _EN_ALIASES:
        if re.search(pattern, low) and aid not in found:
            found.append(aid)
    return found


def collect_other_ids(
    speaker: str | None,
    *,
    present_ids: list[str] | None = None,
    mention_text: str = "",
) -> list[str]:
    """Ids the speaker should get rows for: present + mentioned, minus self."""
    me = normalize_actor_id(speaker)
    others: list[str] = []
    for raw in present_ids or []:
        aid = normalize_actor_id(raw)
        if aid and aid != me and aid not in others:
            others.append(aid)
    for aid in detect_mentioned_ids(mention_text):
        if aid != me and aid not in others:
            others.append(aid)
    return others


def row_for(speaker: str, other: str) -> CastRelation | None:
    a = normalize_actor_id(speaker)
    b = normalize_actor_id(other)
    if not a or not b or a == b:
        return None
    return _PAIR_INDEX.get((a, b)) or _default_row(a, b)


def household_facts(speaker: str, others: list[str]) -> list[str]:
    """White/Schrader house facts — only when that family or Jesse is in play."""
    involved = {normalize_actor_id(speaker), *(normalize_actor_id(o) for o in others)}
    involved.discard("")
    if not involved & _FAMILY:
        return []
    return [
        "The White household is Walter, Skyler, and their children. Hank (DEA, married to Marie) and Marie (Skyler's sister) visit as in-laws.",
        "Jesse Pinkman is not a White or Schrader. He does not live in that house and is not an in-law.",
    ]


def format_cast_relations_block(speaker: str, others: list[str]) -> str:
    """Prompt block with only the rows this speaker needs right now."""
    me = normalize_actor_id(speaker)
    ids = [normalize_actor_id(o) for o in others]
    ids = [o for o in ids if o and o != me]
    if not me or not ids:
        return ""
    lines = [
        "CAST RELATIONS (show-wide public facts only — not era spoilers):",
        "These are canon facts about who is who. Do not invent kinship, a shared household, or forms of address that contradict this table.",
        "Seasonal knowledge (whether someone has met yet, who employs whom this era) is NOT here; obey Continuity Board / era for that.",
    ]
    for fact in household_facts(me, ids):
        lines.append(f"- Household: {fact}")
    for other in ids:
        row = row_for(me, other)
        if row is None:
            continue
        lines.append(
            f"- {DISPLAY_NAME[other]}: {row.who} "
            f"Address: {row.address}. Familiarity: {row.familiarity}."
        )
    return "\n".join(lines)


def crew_player_scope_note(primary: str, relation: str) -> str:
    """Crew: the player belongs only to the primary character's relation."""
    name = DISPLAY_NAME.get(normalize_actor_id(primary), str(primary or "").strip() or "the primary")
    rel = (relation or "").strip() or "relation"
    return (
        f"The player is only {name}'s {rel}. "
        f"That kinship or household role belongs to {name} alone. "
        f"Other characters' relationships to the player and to {name}'s household "
        f"come from CAST RELATIONS — do not invent kinship, a shared house, or in-laws."
    )


_KINSHIP = re.compile(
    r"姐夫|妹夫|连襟|brother-in-law|my brother|我的兄弟|我哥|我弟|"
    r"老公|丈夫|husband|我老婆|妻子|wife|家人",
    re.I,
)
_HOUSEHOLD_OURS = re.compile(r"我们家|我家蹭|at our house|mooch(?:es|ing)?(?:\s+dinner)?", re.I)
_WALTER_VOCATIVE = re.compile(
    r"(沃尔特|Walter)\s*[，,]\s*你|(?:^|[。！？\n?\s])(沃尔特|Walter)\s*[，,！!]",
    re.I,
)


def flag_relation_errors(speaker: str, text: str) -> list[str]:
    """Mechanical failure modes from issue #81: invented kin, wrong house, wrong address."""
    who = normalize_actor_id(speaker)
    blob = text or ""
    mentioned = set(detect_mentioned_ids(blob))
    flags: list[str] = []

    if who == "jesse":
        if mentioned & {"hank", "marie", "skyler"} and _KINSHIP.search(blob):
            flags.append("invented_kinship")
        if "hank" in mentioned and _HOUSEHOLD_OURS.search(blob):
            flags.append("wrong_household")
        if "walter" in mentioned and _WALTER_VOCATIVE.search(blob):
            flags.append("wrong_address")
        # English "Hank is my brother-in-law" already hits _KINSHIP; keep a direct hit.
        if re.search(r"\bmy brother-in-law\b", blob, re.I):
            if "invented_kinship" not in flags:
                flags.append("invented_kinship")

    if who == "marie" and "saul" in mentioned and _KINSHIP.search(blob):
        flags.append("invented_kinship")
        if _HOUSEHOLD_OURS.search(blob) or "我们家的人" in blob:
            if "wrong_household" not in flags:
                flags.append("wrong_household")

    return flags
