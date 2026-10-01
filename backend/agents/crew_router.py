"""Who talks in a crew (group) chat turn.

One lead answers the player. At most one other person cuts in, and only with a
reason: the player named them, the lead called them out, or the two of them
have a standing conflict. The turn then goes back to the player. Never the
whole room. See docs/research/2026-10-01-chat-feel-round2-chatgpt.md.
"""

from __future__ import annotations

import re
from typing import Any

FRONTEND_TO_BACKEND: dict[str, str] = {
    "walter": "Walter White",
    "jesse": "Jesse Pinkman",
    "skyler": "Skyler White",
    "saul": "Saul Goodman",
    "mike": "Mike Ehrmantraut",
    "gus": "Gus Fring",
    "hank": "Hank Schrader",
    "marie": "Marie Schrader",
}
BACKEND_TO_FRONTEND: dict[str, str] = {v: k for k, v in FRONTEND_TO_BACKEND.items()}

# English names need word boundaries; CJK names match as substrings.
MENTION_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"\bwalter\b|\bwalt\b", "Walter White"),
    (r"\bsaul\b", "Saul Goodman"),
    (r"\bmike\b", "Mike Ehrmantraut"),
    (r"\bgus\b", "Gus Fring"),
    (r"\bskyler\b", "Skyler White"),
    (r"\bjesse\b", "Jesse Pinkman"),
    (r"\bhank\b", "Hank Schrader"),
    (r"\bschrader\b", "Hank Schrader"),
    (r"\bmarie\b", "Marie Schrader"),
)
CJK_ALIASES: tuple[tuple[str, str], ...] = (
    ("沃尔特", "Walter White"),
    ("杰西", "Jesse Pinkman"),
    ("古斯", "Gus Fring"),
    ("麦克", "Mike Ehrmantraut"),
    ("迈克", "Mike Ehrmantraut"),  # variant spelling, recognized but never displayed
    ("索尔", "Saul Goodman"),
    ("斯凯勒", "Skyler White"),
    ("汉克", "Hank Schrader"),
    ("玛丽", "Marie Schrader"),
)

DISPLAY_ZH: dict[str, str] = {}
for _alias, _name in CJK_ALIASES:
    DISPLAY_ZH.setdefault(_name, _alias)  # first spelling is the display name
DISPLAY_EN: dict[str, str] = {name: name.split()[0] for name in BACKEND_TO_FRONTEND}

# Every way a line might start with a speaker label ("walter:", "古斯:", "Gus Fring:").
_ALIAS_RE = "|".join(
    sorted(
        {re.escape(a) for a in (
            [alias for alias, _ in CJK_ALIASES]
            + list(FRONTEND_TO_BACKEND)
            + list(BACKEND_TO_FRONTEND)
            + [n.split()[0] for n in BACKEND_TO_FRONTEND]
            + ["walt", "玩家", "player"]
        )},
        key=len,
        reverse=True,
    )
)
_PREFIX = re.compile(rf"^\s*(?:{_ALIAS_RE})\s*[:：]\s*", re.IGNORECASE)
_OTHER_SPEAKER = re.compile(rf"\n\s*(?:{_ALIAS_RE})\s*[:：]", re.IGNORECASE)
_SEPARATORS = "、，,和跟与&/ \t—-"

# Pairs whose presence in the same room is enough for one to cut in on the other.
CONFLICTS: frozenset[frozenset[str]] = frozenset(
    frozenset(pair)
    for pair in (
        ("Walter White", "Jesse Pinkman"),
        ("Walter White", "Hank Schrader"),
        ("Walter White", "Skyler White"),
        ("Walter White", "Gus Fring"),
        ("Jesse Pinkman", "Hank Schrader"),
        ("Jesse Pinkman", "Gus Fring"),
        ("Skyler White", "Marie Schrader"),
        ("Saul Goodman", "Mike Ehrmantraut"),
        ("Hank Schrader", "Gus Fring"),
    )
)

ROOM_CAP = 4


def mentions_in_order(text: str) -> list[str]:
    """Backend names mentioned in ``text``, in the order they first appear."""
    raw = text or ""
    low = raw.lower()
    first_at: dict[str, int] = {}
    for alias, name in CJK_ALIASES:
        i = raw.find(alias)
        if i >= 0:
            first_at[name] = min(first_at.get(name, i), i)
    for pattern, name in MENTION_PATTERNS:
        m = re.search(pattern, low)
        if m:
            first_at[name] = min(first_at.get(name, m.start()), m.start())
    return sorted(first_at, key=first_at.__getitem__)


def addressed_in_order(text: str) -> list[str]:
    """People the player speaks TO: names at the very start ("杰西，…", "Jesse, Hank —").

    Talking about someone ("沃尔特说你在骗他") is not addressing them.
    """
    rest = (text or "").lstrip().lstrip("@")
    names: list[str] = []
    while rest:
        hit = None
        for alias, name in CJK_ALIASES:
            if rest.startswith(alias):
                hit = (alias, name)
                break
        if hit is None:
            for pattern, name in MENTION_PATTERNS:
                m = re.match(pattern, rest, re.IGNORECASE)
                if m:
                    hit = (m.group(0), name)
                    break
        if hit is None:
            break
        alias, name = hit
        after = rest[len(alias):]
        trimmed = after.lstrip(_SEPARATORS)
        stops_here = (not after) or after[0] in "，,：:！!？?。、 \t—-" or after.startswith(("你", "您"))
        if not stops_here:
            break  # e.g. "杰西卡" or "沃尔特说" — a name inside a sentence, not a vocative
        if name not in names:
            names.append(name)
        rest = trimmed.lstrip("@")
        if after and after[0] not in "、,，和跟与&/ \t—-":
            break
    return names


def clean_crew_line(text: str, speaker: str) -> str:
    """Drop a leading speaker label and anything the model wrote for someone else."""
    line = (text or "").strip()
    while True:
        stripped = _PREFIX.sub("", line, count=1)
        if stripped == line:
            break
        line = stripped
    cut = _OTHER_SPEAKER.search(line)
    if cut:
        line = line[: cut.start()]
    return line.strip()


def crew_history_for(speaker: str, history: list[dict[str, Any]], *, language: str = "zh") -> list[dict[str, str]]:
    """Recent group history from one speaker's seat: their own lines are theirs,
    everyone else is labeled by name (labels in the reply language)."""
    zh = str(language).lower().startswith("zh")
    sep = "：" if zh else ": "
    out: list[dict[str, str]] = []
    for turn in (history or [])[-12:]:
        text = str(turn.get("text") or "").strip()
        if not text:
            continue
        if str(turn.get("sender")) == "user":
            out.append({"role": "user", "content": f"{'玩家' if zh else 'Player'}{sep}{text}"})
            continue
        name = _speaker(turn)
        if name == speaker:
            out.append({"role": "assistant", "content": text})
        elif name:
            label = DISPLAY_ZH[name] if zh else DISPLAY_EN[name]
            out.append({"role": "user", "content": f"{label}{sep}{text}"})
    return out


def _speaker(turn: dict[str, Any]) -> str | None:
    sender = str(turn.get("sender") or "")
    return FRONTEND_TO_BACKEND.get(sender) or (sender if sender in BACKEND_TO_FRONTEND else None)


def _last_round(history: list[dict[str, Any]]) -> list[str]:
    """Characters who spoke after the player's most recent line."""
    speakers: list[str] = []
    for turn in reversed(history or []):
        if str(turn.get("sender")) == "user":
            break
        name = _speaker(turn)
        if name:
            speakers.append(name)
    return list(reversed(speakers))


def crew_room(primary_id: str, history: list[dict[str, Any]], user_message: str) -> list[str]:
    """The selected character, whoever spoke recently, and whoever the player addresses now."""
    primary = FRONTEND_TO_BACKEND.get(primary_id, primary_id)
    room = [primary]
    for turn in reversed((history or [])[-12:]):
        name = _speaker(turn)
        if name and name not in room:
            room.append(name)
    for name in addressed_in_order(user_message):
        if name not in room:
            room.append(name)
    # Keep the primary and the most relevant others: addressed now beats recent.
    named = [n for n in addressed_in_order(user_message) if n != primary]
    others = named + [n for n in room[1:] if n not in named]
    return [primary, *others][:ROOM_CAP]


def pick_lead(room: list[str], user_message: str, *, history: list[dict[str, Any]]) -> str:
    """First person addressed; else whoever just spoke; else the selected character."""
    for name in addressed_in_order(user_message):
        if name in room:
            return name
    last = _last_round(history)
    if last and last[0] in room:
        return last[0]
    return room[0]


def pick_reactor(
    room: list[str],
    *,
    lead: str,
    lead_reply: str,
    user_message: str,
    history: list[dict[str, Any]],
) -> str | None:
    """At most one person cuts in after the lead, and only with a reason."""
    others = [n for n in room if n != lead]
    if not others:
        return None
    # Addressed too, or talked about while present ("被指控者"), or called out by the lead.
    for name in addressed_in_order(user_message) + mentions_in_order(user_message):
        if name in others:
            return name
    for name in mentions_in_order(lead_reply):
        if name in others:
            return name
    just_spoke = set(_last_round(history)[1:])  # reactors from the previous round
    for name in others:
        if frozenset((lead, name)) in CONFLICTS and name not in just_spoke:
            return name
    return None
