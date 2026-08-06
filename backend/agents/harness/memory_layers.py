"""Layered memory (ch3) — working / episodic / semantic.

WorkingMemory: ring buffer of recent dialogue turns.
EpisodicMemory: timestamped summaries with importance + tags.
SemanticMemory: durable key→value facts with source.
LayeredMemory: facade that observes turns and formats for context.
"""

from __future__ import annotations

import json
import re
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class TurnRecord:
    role: str
    content: str
    ts: float = field(default_factory=time.time)


@dataclass
class Episode:
    ts: float
    summary: str
    importance: int = 1
    tags: list[str] = field(default_factory=list)


@dataclass
class Fact:
    key: str
    value: str
    source: str = "session"


class WorkingMemory:
    """Ring buffer of recent turns (max 20 by default)."""

    def __init__(self, max_turns: int = 20) -> None:
        self.max_turns = max_turns
        self._buf: deque[TurnRecord] = deque(maxlen=max_turns)

    def add(self, role: str, content: str) -> None:
        self._buf.append(TurnRecord(role=role, content=content))

    def recent(self, n: int | None = None) -> list[TurnRecord]:
        items = list(self._buf)
        if n is None:
            return items
        return items[-n:] if n > 0 else []

    def clear(self) -> None:
        self._buf.clear()

    def to_list(self) -> list[dict[str, Any]]:
        return [asdict(t) for t in self._buf]

    @classmethod
    def from_list(cls, data: list[dict[str, Any]], max_turns: int = 20) -> WorkingMemory:
        wm = cls(max_turns=max_turns)
        for item in data or []:
            wm.add(str(item.get("role", "user")), str(item.get("content", "")))
        return wm


class EpisodicMemory:
    """List of episodic summaries with keyword search."""

    def __init__(self) -> None:
        self.episodes: list[Episode] = []

    def add(
        self,
        summary: str,
        importance: int = 1,
        tags: list[str] | None = None,
        ts: float | None = None,
    ) -> Episode:
        ep = Episode(
            ts=ts if ts is not None else time.time(),
            summary=summary,
            importance=importance,
            tags=list(tags or []),
        )
        self.episodes.append(ep)
        return ep

    def search(self, query: str, limit: int = 5) -> list[Episode]:
        tokens = _tokens(query)
        if not tokens:
            # no query → return highest importance
            ranked = sorted(self.episodes, key=lambda e: (-e.importance, -e.ts))
            return ranked[:limit]
        scored: list[tuple[int, Episode]] = []
        for ep in self.episodes:
            hay = (ep.summary + " " + " ".join(ep.tags)).lower()
            score = sum(1 for t in tokens if t in hay)
            score += ep.importance
            if score > ep.importance:  # at least one keyword hit
                scored.append((score, ep))
        scored.sort(key=lambda x: (-x[0], -x[1].ts))
        return [e for _, e in scored[:limit]]

    def to_list(self) -> list[dict[str, Any]]:
        return [asdict(e) for e in self.episodes]

    @classmethod
    def from_list(cls, data: list[dict[str, Any]]) -> EpisodicMemory:
        em = cls()
        for item in data or []:
            em.add(
                summary=str(item.get("summary", "")),
                importance=int(item.get("importance", 1)),
                tags=list(item.get("tags") or []),
                ts=float(item["ts"]) if item.get("ts") is not None else None,
            )
        return em


class SemanticMemory:
    """Dict of durable facts key→value with source."""

    def __init__(self) -> None:
        self.facts: dict[str, Fact] = {}

    def upsert(self, key: str, value: str, source: str = "session") -> Fact:
        fact = Fact(key=key, value=value, source=source)
        self.facts[key] = fact
        return fact

    def get(self, key: str) -> Fact | None:
        return self.facts.get(key)

    def search(self, query: str, limit: int = 10) -> list[Fact]:
        tokens = _tokens(query)
        if not tokens:
            return list(self.facts.values())[:limit]
        scored: list[tuple[int, Fact]] = []
        for fact in self.facts.values():
            hay = f"{fact.key} {fact.value} {fact.source}".lower()
            score = sum(1 for t in tokens if t in hay)
            if score > 0:
                scored.append((score, fact))
        scored.sort(key=lambda x: (-x[0], x[1].key))
        return [f for _, f in scored[:limit]]

    def to_dict(self) -> dict[str, dict[str, str]]:
        return {
            k: {"value": f.value, "source": f.source}
            for k, f in self.facts.items()
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SemanticMemory:
        sm = cls()
        for key, payload in (data or {}).items():
            if isinstance(payload, dict):
                sm.upsert(
                    key,
                    str(payload.get("value", "")),
                    source=str(payload.get("source", "session")),
                )
            else:
                sm.upsert(key, str(payload), source="session")
        return sm


class LayeredMemory:
    """Facade over working + episodic + semantic layers."""

    def __init__(
        self,
        working: WorkingMemory | None = None,
        episodic: EpisodicMemory | None = None,
        semantic: SemanticMemory | None = None,
    ) -> None:
        self.working = working or WorkingMemory()
        self.episodic = episodic or EpisodicMemory()
        self.semantic = semantic or SemanticMemory()

    def observe_turn(self, role: str, content: str) -> None:
        self.working.add(role, content)

    def remember_episode(
        self,
        summary: str,
        importance: int = 1,
        tags: list[str] | None = None,
    ) -> Episode:
        return self.episodic.add(summary, importance=importance, tags=tags)

    def remember_fact(self, key: str, value: str, source: str = "session") -> Fact:
        return self.semantic.upsert(key, value, source=source)

    def ingest_dossier_snapshot(self, owner_id: str, dossier: dict) -> int:
        """Map a CharacterDossier-shaped dict into semantic facts + one episodic note.

        No DB access. Accepts loose field names used by memory.py / world dumps:
        subject_id|subject, trust_level|trust, knowledge (dict or JSON str),
        relationship_notes|notes.

        Returns the number of semantic facts written.
        """
        if not isinstance(dossier, dict):
            return 0
        owner = str(owner_id or "").strip().lower()
        if not owner:
            return 0

        # Allow "walter->jesse" owner keys to carry subject
        subject = str(
            dossier.get("subject_id")
            or dossier.get("subject")
            or dossier.get("about")
            or ""
        ).strip().lower()
        if not subject and "->" in owner:
            left, _, right = owner.partition("->")
            owner = left.strip().lower() or owner
            subject = right.strip().lower()
        if not subject:
            subject = "unknown"

        written = 0
        prefix = f"{owner}->{subject}"

        trust = dossier.get("trust_level", dossier.get("trust"))
        if trust is not None and str(trust).strip() != "":
            self.remember_fact(f"{prefix}.trust", str(trust), source="dossier")
            written += 1

        knowledge = dossier.get("knowledge")
        if isinstance(knowledge, str):
            raw = knowledge.strip()
            if raw:
                try:
                    parsed = json.loads(raw)
                    knowledge = parsed if isinstance(parsed, dict) else {"raw": raw}
                except (json.JSONDecodeError, TypeError):
                    knowledge = {"raw": raw}
            else:
                knowledge = {}
        if isinstance(knowledge, dict):
            for k, v in knowledge.items():
                if v is None or str(v).strip() == "":
                    continue
                safe_k = re.sub(r"[^\w.\-]+", "_", str(k).strip())[:80] or "item"
                self.remember_fact(
                    f"{prefix}.knowledge.{safe_k}",
                    str(v),
                    source="dossier",
                )
                written += 1
        elif knowledge is not None and str(knowledge).strip():
            self.remember_fact(
                f"{prefix}.knowledge",
                str(knowledge),
                source="dossier",
            )
            written += 1

        notes = dossier.get("relationship_notes")
        if notes is None:
            notes = dossier.get("notes")
        notes_s = str(notes).strip() if notes is not None else ""
        if notes_s:
            self.remember_fact(
                f"{prefix}.relationship_notes",
                notes_s[:800],
                source="dossier",
            )
            written += 1

        # One episodic note summarizing the snapshot (even if only partial fields)
        if written:
            trust_bit = f" trust={trust}" if trust is not None else ""
            note_bit = f" notes={notes_s[:120]}" if notes_s else ""
            self.remember_episode(
                f"dossier {prefix}:{trust_bit}{note_bit}".strip(),
                importance=3,
                tags=["dossier", owner, subject],
            )
        return written

    def export_facts_for_character(self, character_id: str) -> dict[str, Any]:
        """Export semantic facts related to a character id (key/value/source).

        Matches character_id appearing in fact keys (e.g. walter->jesse.trust)
        or values. Returns a plain dict suitable for prompts / debugging.
        """
        cid = str(character_id or "").strip().lower()
        out: dict[str, Any] = {}
        if not cid:
            return out
        for key, fact in self.semantic.facts.items():
            hay = f"{key} {fact.value}".lower()
            if cid in hay:
                out[key] = {"value": fact.value, "source": fact.source}
        return out

    def format_for_context(self, query: str, *, max_chars: int = 2000) -> str:
        """Combine relevant layers into a single context string."""
        parts: list[str] = []

        # Semantic facts first (durable, high signal)
        facts = self.semantic.search(query, limit=8) if query else list(
            self.semantic.facts.values()
        )[:8]
        if not facts and self.semantic.facts:
            facts = list(self.semantic.facts.values())[:5]
        if facts:
            lines = ["[semantic]"]
            for f in facts:
                lines.append(f"- {f.key}: {f.value}")
            parts.append("\n".join(lines))

        # Episodes
        episodes = self.episodic.search(query, limit=5)
        if not episodes and self.episodic.episodes:
            episodes = sorted(
                self.episodic.episodes, key=lambda e: (-e.importance, -e.ts)
            )[:3]
        if episodes:
            lines = ["[episodic]"]
            for ep in episodes:
                tag_s = f" tags={','.join(ep.tags)}" if ep.tags else ""
                lines.append(f"- (imp={ep.importance}{tag_s}) {ep.summary}")
            parts.append("\n".join(lines))

        # Working recent turns
        recent = self.working.recent(6)
        if recent:
            lines = ["[working]"]
            for t in recent:
                snippet = t.content.replace("\n", " ").strip()
                if len(snippet) > 120:
                    snippet = snippet[:120] + "…"
                lines.append(f"- {t.role}: {snippet}")
            parts.append("\n".join(lines))

        text = "\n\n".join(parts)
        if len(text) > max_chars:
            text = text[: max_chars - 1] + "…"
        return text

    def to_dict(self) -> dict[str, Any]:
        return {
            "working": self.working.to_list(),
            "episodic": self.episodic.to_list(),
            "semantic": self.semantic.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> LayeredMemory:
        data = data or {}
        return cls(
            working=WorkingMemory.from_list(data.get("working") or []),
            episodic=EpisodicMemory.from_list(data.get("episodic") or []),
            semantic=SemanticMemory.from_dict(data.get("semantic") or {}),
        )


def _tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-zA-Z0-9_\u4e00-\u9fff]+", (text or "").lower()) if len(t) > 1]
