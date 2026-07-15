"""Plan layer: typed story plan (spine + beats) for narrative Agent orchestration.

DEC-0004 seam A: PlanService owns outline parse / validate / structured JSON.
McKee craft policy stays in mckee_story; this module is the first-class Plan object.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from agents import mckee_story

# Beat-local field extractors (value / gap / risk on a playable line).
_VALUE_FIELDS_RE = re.compile(
    r"value\s*:\s*([^—\-\n]+?)(?:→|->|=>|→)\s*([^—\-\n]+?)(?=\s*[—\-]\s*gap\s*:|\s+gap\s*:|$)",
    re.IGNORECASE,
)
_GAP_RE = re.compile(
    r"gap\s*:\s*(.+?)(?=\s*[—\-]\s*risk\s*:|\s+risk\s*:|$)",
    re.IGNORECASE,
)
_RISK_RE = re.compile(r"risk\s*:\s*(.+?)\s*$", re.IGNORECASE)
_LIST_ITEM_RE = re.compile(r"^[\s]*(\d+[\.\)]\s+|[-\*]\s+)")


@dataclass
class BeatPlan:
    """One playable beat in the structured story plan."""

    index: int
    text: str
    role: str
    value_before: str | None = None
    value_after: str | None = None
    gap: str | None = None
    risk: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "text": self.text,
            "role": self.role,
            "value_before": self.value_before,
            "value_after": self.value_after,
            "gap": self.gap,
            "risk": self.risk,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> BeatPlan:
        return cls(
            index=int(data.get("index", 0)),
            text=str(data.get("text") or ""),
            role=str(data.get("role") or "progressive"),
            value_before=data.get("value_before"),
            value_after=data.get("value_after"),
            gap=data.get("gap"),
            risk=data.get("risk"),
        )


@dataclass
class StoryPlan:
    """Typed plan: McKee spine meta + ordered playable beats.

    ``raw_outline`` keeps the prose the LLM produced (needed for beat prompts).
    ``beats`` / ``spine`` are the structured surface for Runtime, eval, and later UI.
    """

    raw_outline: str
    spine: dict[str, str] = field(default_factory=dict)
    beats: list[BeatPlan] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def scene_lines(self) -> list[str]:
        """Backward-compatible list of beat texts (Director used list[str])."""
        return [b.text for b in self.beats]

    def beat_at(self, index: int) -> BeatPlan | None:
        if 0 <= index < len(self.beats):
            return self.beats[index]
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "raw_outline": self.raw_outline,
            "spine": dict(self.spine),
            "beats": [b.to_dict() for b in self.beats],
            "warnings": list(self.warnings),
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> StoryPlan:
        beats_raw = data.get("beats") or []
        beats = [
            BeatPlan.from_dict(b) if isinstance(b, dict) else BeatPlan(index=i, text=str(b), role="progressive")
            for i, b in enumerate(beats_raw)
        ]
        return cls(
            raw_outline=str(data.get("raw_outline") or ""),
            spine=dict(data.get("spine") or {}),
            beats=beats,
            warnings=list(data.get("warnings") or []),
        )

    @classmethod
    def from_json(cls, payload: str) -> StoryPlan:
        return cls.from_dict(json.loads(payload))


def extract_value_pair(text: str) -> tuple[str | None, str | None]:
    """Parse value: before→after from a beat line."""
    if not text:
        return None, None
    m = _VALUE_FIELDS_RE.search(text)
    if not m:
        # Fallback to mckee_story's looser value turn regex
        m2 = mckee_story._VALUE_TURN_RE.search(text)
        if not m2:
            return None, None
        return m2.group(1).strip(), m2.group(2).strip()
    return m.group(1).strip(), m.group(2).strip()


def extract_gap(text: str) -> str | None:
    if not text:
        return None
    m = _GAP_RE.search(text)
    return m.group(1).strip() if m else None


def extract_risk(text: str) -> str | None:
    if not text:
        return None
    m = _RISK_RE.search(text)
    return m.group(1).strip() if m else None


def parse_scene_lines(text: str) -> list[str]:
    """Parse LLM outline prose into playable scene lines (no spine meta).

    Handles McKee meta headers, plain numbered lists, and JSON-ish outlines.
    Mirrors the historical DirectorAgent._parse_outline behaviour so existing
    tests and plot_graph callers stay compatible.
    """
    if not text:
        return []
    text = mckee_story.filter_playable_outline_lines(text)
    stripped = text.strip()
    if stripped.startswith(("[", "{")):
        extracted = _extract_text_from_json_outline(stripped)
        if extracted != stripped:
            text = extracted
    scenes: list[str] = []
    current: list[str] = []
    for raw_line in text.splitlines():
        stripped_line = raw_line.strip()
        if not stripped_line:
            continue
        if _LIST_ITEM_RE.match(stripped_line):
            if current:
                scenes.append(" ".join(current).strip())
                current = []
            content = _LIST_ITEM_RE.sub("", stripped_line).strip()
            current.append(content)
        elif current:
            if mckee_story.is_meta_outline_line(stripped_line):
                continue
            current.append(stripped_line)
    if current:
        scenes.append(" ".join(current).strip())
    if scenes:
        return scenes
    stripped = text.strip()
    return [stripped] if stripped else []


def _extract_text_from_json_outline(stripped: str) -> str:
    """Best-effort: pull readable strings from a JSON outline blob.

    Matches DirectorAgent._extract_text_from_json_outline so PlanService
    and Director stay on one parser path.
    """
    try:
        data = json.loads(stripped)
        if isinstance(data, list):
            lines: list[str] = []
            for i, item in enumerate(data, 1):
                if isinstance(item, dict):
                    scene = (
                        item.get("scene")
                        or item.get("title")
                        or item.get("name", "")
                    )
                    desc = item.get("description") or item.get("desc", "")
                    text = f"{scene} — {desc}" if desc else scene
                    if text:
                        lines.append(f"{i}. {text}")
                elif isinstance(item, str):
                    lines.append(f"{i}. {item}")
            return "\n".join(lines) if lines else stripped
        if isinstance(data, dict):
            beats = data.get("beats") or data.get("scenes") or data.get("outline")
            if isinstance(beats, list):
                return _extract_text_from_json_outline(json.dumps(beats))
            if isinstance(beats, str):
                return beats
    except (json.JSONDecodeError, TypeError):
        pass
    return stripped


def build_beat_plan(text: str, index: int, total: int) -> BeatPlan:
    """Structure one scene line into a BeatPlan with role/value/gap/risk."""
    role = mckee_story.resolve_beat_role(text, index, total)
    before, after = extract_value_pair(text)
    return BeatPlan(
        index=index,
        text=text,
        role=role,
        value_before=before,
        value_after=after,
        gap=extract_gap(text),
        risk=extract_risk(text),
    )


class PlanService:
    """Deep module: prose outline ↔ typed StoryPlan.

    Callers only need ``parse`` / ``from_json`` / ``outline_event_data``.
    """

    @staticmethod
    def parse(outline_text: str | None) -> StoryPlan:
        """Parse prose (or empty) into a StoryPlan with structured beats."""
        raw = outline_text or ""
        spine = mckee_story.parse_spine_meta(raw)
        scenes = parse_scene_lines(raw)
        return PlanService.parse_from_scenes(scenes, raw_outline=raw, spine=spine)

    @staticmethod
    def parse_from_scenes(
        scenes: list[str],
        *,
        raw_outline: str = "",
        spine: dict[str, str] | None = None,
    ) -> StoryPlan:
        """Build a StoryPlan from an already-split scene list (branch/chapter)."""
        total = len(scenes)
        beats = [build_beat_plan(s, i, total) for i, s in enumerate(scenes)]
        warnings = mckee_story.validate_outline_structure(scenes)
        return StoryPlan(
            raw_outline=raw_outline
            or "\n".join(f"{i + 1}. {s}" for i, s in enumerate(scenes)),
            spine=dict(spine or {}),
            beats=beats,
            warnings=warnings,
        )

    @staticmethod
    def from_json(payload: str) -> StoryPlan:
        return StoryPlan.from_json(payload)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> StoryPlan:
        return StoryPlan.from_dict(data)

    @staticmethod
    def validate(plan: StoryPlan) -> list[str]:
        """Return soft structure warnings (empty = OK enough)."""
        if plan.warnings:
            return list(plan.warnings)
        return mckee_story.validate_outline_structure(plan.scene_lines())

    @staticmethod
    def outline_event_data(plan: StoryPlan) -> dict[str, Any]:
        """SSE outline payload: legacy McKee fields + first-class story_plan."""
        payload = mckee_story.outline_event_payload(
            plan.raw_outline, scenes=plan.scene_lines()
        )
        # First-class structured plan (DEC-0004 acceptance).
        payload["story_plan"] = {
            "spine": plan.spine,
            "beats": [b.to_dict() for b in plan.beats],
            "warnings": plan.warnings,
            "beat_count": len(plan.beats),
        }
        return payload

    @staticmethod
    def quality_checks(plan: StoryPlan) -> dict[str, bool]:
        """Structured story-quality flags for tests (not only string contains)."""
        roles = {b.role for b in plan.beats}
        has_value = sum(1 for b in plan.beats if b.value_before and b.value_after)
        has_gap = sum(1 for b in plan.beats if b.gap)
        has_risk = sum(1 for b in plan.beats if b.risk)
        n = len(plan.beats)
        return {
            "has_beats": n > 0,
            "enough_beats": n >= 4,
            "has_inciting": "inciting" in roles,
            "has_climax": "climax" in roles,
            "most_have_value_turn": has_value >= max(1, n // 2) if n else False,
            "most_have_gap": has_gap >= max(1, n // 2) if n else False,
            "most_have_risk": has_risk >= max(1, n // 2) if n else False,
            "has_spine_controlling_idea": bool(plan.spine.get("controlling_idea")),
            "has_spine_protagonist": bool(plan.spine.get("protagonist")),
            "no_warnings": len(plan.warnings) == 0,
        }
