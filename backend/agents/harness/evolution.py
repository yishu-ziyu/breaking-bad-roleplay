"""Lesson extraction and storage from trajectories (ch8).

No LLM required: heuristic lessons from errors, guardrail hits, and successful tool patterns.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from agents.harness.trajectory import TrajectoryRecord

_DEFAULT_LESSONS_PATH = (
    Path(__file__).resolve().parent / "data" / "lessons.json"
)

LessonCategory = str  # knowledge | instruction | program


@dataclass
class Lesson:
    """A reusable lesson distilled from a run trajectory."""

    id: str
    source_run_id: str
    category: str  # knowledge | instruction | program
    content: str
    confidence: float = 0.5
    created_at: float = field(default_factory=lambda: time.time())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Lesson:
        return cls(
            id=str(data.get("id") or uuid.uuid4().hex[:12]),
            source_run_id=str(data.get("source_run_id") or ""),
            category=str(data.get("category") or "knowledge"),
            content=str(data.get("content") or ""),
            confidence=float(data.get("confidence") or 0.5),
            created_at=float(data.get("created_at") or time.time()),
        )


class LessonStore:
    """JSON-file-backed lesson store under harness/data/lessons.json."""

    def __init__(self, path: Path | str | None = _DEFAULT_LESSONS_PATH) -> None:
        self.path = Path(path) if path else _DEFAULT_LESSONS_PATH
        self._lock = threading.RLock()
        self._lessons: list[Lesson] = []
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            self._lessons = []
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            items = raw if isinstance(raw, list) else raw.get("lessons") or []
            self._lessons = [Lesson.from_dict(x) for x in items if isinstance(x, dict)]
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            self._lessons = []

    def _save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            payload = [lesson.to_dict() for lesson in self._lessons]
            self.path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError:
            pass

    def add_lesson(self, lesson: Lesson) -> Lesson:
        with self._lock:
            self._lessons.append(lesson)
            self._save()
            return lesson

    def list_lessons(
        self,
        category: str | None = None,
        limit: int | None = None,
    ) -> list[Lesson]:
        with self._lock:
            items = list(self._lessons)
        if category:
            items = [x for x in items if x.category == category]
        # Higher confidence first, then newer
        items.sort(key=lambda x: (x.confidence, x.created_at), reverse=True)
        if limit is not None:
            items = items[: max(0, limit)]
        return items

    def format_for_prompt(self, top_k: int = 5) -> str:
        """Format top-k lessons as a compact prompt block."""
        lessons = self.list_lessons(limit=top_k)
        if not lessons:
            return ""
        lines = ["## Lessons from prior runs"]
        for i, lesson in enumerate(lessons, 1):
            lines.append(
                f"{i}. [{lesson.category}] (conf={lesson.confidence:.2f}) {lesson.content}"
            )
        return "\n".join(lines)

    def extract_lessons_from_trajectory(
        self,
        traj: TrajectoryRecord | dict[str, Any],
        *,
        persist: bool = True,
    ) -> list[Lesson]:
        """Heuristic lesson extraction — no LLM.

        - errors / guardrail hits / repeated tools → instruction lessons
        - successful tool patterns → knowledge lessons
        """
        if hasattr(traj, "to_dict"):
            data = traj.to_dict()  # type: ignore[union-attr]
        else:
            data = dict(traj)

        run_id = str(data.get("run_id") or "unknown")
        events = data.get("events") or []
        summary = data.get("result_summary") or {}

        tool_names: list[str] = []
        error_events: list[dict[str, Any]] = []
        guardrail_hits: list[str] = []
        success_tools: list[str] = []

        for raw in events:
            if hasattr(raw, "to_dict"):
                ev = raw.to_dict()
            elif isinstance(raw, dict):
                ev = raw
            else:
                continue
            etype = str(ev.get("type") or "")
            edata = ev.get("data") or {}
            if not isinstance(edata, dict):
                edata = {}

            if etype in ("tool_call", "tool", "tool_result", "tool_ok", "tool_error"):
                name = str(
                    edata.get("name")
                    or edata.get("tool")
                    or edata.get("tool_name")
                    or ""
                )
                if name:
                    tool_names.append(name)
                is_error = bool(
                    edata.get("is_error")
                    or edata.get("error")
                    or etype == "tool_error"
                )
                if is_error:
                    error_events.append({"name": name, **edata})
                elif name:
                    success_tools.append(name)

            if etype in ("guardrail", "guardrail_violation", "safety_block"):
                reason = str(
                    edata.get("reason")
                    or edata.get("violation")
                    or edata.get("message")
                    or "guardrail"
                )
                guardrail_hits.append(reason)

            if etype == "error":
                error_events.append(edata)

        # From result_summary
        for v in summary.get("violations") or []:
            guardrail_hits.append(str(v))
        if summary.get("error"):
            error_events.append({"error": summary.get("error")})

        lessons: list[Lesson] = []

        # Instruction: guardrails
        for reason in guardrail_hits[:5]:
            lessons.append(
                Lesson(
                    id=uuid.uuid4().hex[:12],
                    source_run_id=run_id,
                    category="instruction",
                    content=(
                        f"Avoid triggering safety guardrail: {reason}. "
                        "Stay in fictional drama; never give real-world crime how-to."
                    ),
                    confidence=0.85,
                )
            )

        # Instruction: tool errors
        for err in error_events[:5]:
            name = err.get("name") or err.get("tool") or "tool"
            msg = err.get("content") or err.get("error") or err.get("message") or "failed"
            lessons.append(
                Lesson(
                    id=uuid.uuid4().hex[:12],
                    source_run_id=run_id,
                    category="instruction",
                    content=f"Tool {name} failed ({msg}); check args against schema before retry.",
                    confidence=0.7,
                )
            )

        # Instruction: repeated tools (possible loop)
        counts = Counter(tool_names)
        for name, count in counts.items():
            if count >= 3:
                lessons.append(
                    Lesson(
                        id=uuid.uuid4().hex[:12],
                        source_run_id=run_id,
                        category="instruction",
                        content=(
                            f"Tool {name} was called {count} times in one run — "
                            "avoid retry loops; synthesize from first successful result."
                        ),
                        confidence=0.75,
                    )
                )

        # Knowledge: successful tool patterns
        if success_tools:
            uniq = list(dict.fromkeys(success_tools))  # order-preserving unique
            lessons.append(
                Lesson(
                    id=uuid.uuid4().hex[:12],
                    source_run_id=run_id,
                    category="knowledge",
                    content=(
                        "Successful tool sequence: "
                        + " → ".join(uniq[:8])
                        + ". Prefer this order for similar RP beats."
                    ),
                    confidence=0.6,
                )
            )

        # Program: if summary marks success with few tools — keep policy thin
        if summary.get("ok") is True and len(tool_names) <= 2 and not error_events:
            lessons.append(
                Lesson(
                    id=uuid.uuid4().hex[:12],
                    source_run_id=run_id,
                    category="program",
                    content=(
                        "Short successful run: prefer minimal tool use when "
                        "dossier/continuity already answer the beat."
                    ),
                    confidence=0.55,
                )
            )

        if persist:
            with self._lock:
                self._lessons.extend(lessons)
                self._save()

        return lessons


_default_lesson_store: LessonStore | None = None
_default_lesson_lock = threading.Lock()


def get_lesson_store(path: Path | str | None = None) -> LessonStore:
    """Process-wide default LessonStore (lazy singleton).

    If ``path`` is provided, return a fresh store for that path without
    replacing the default singleton.
    """
    global _default_lesson_store
    if path is not None:
        return LessonStore(path=path)
    with _default_lesson_lock:
        if _default_lesson_store is None:
            _default_lesson_store = LessonStore()
        return _default_lesson_store


def reset_lesson_store_for_tests(path: Path | str | None = None) -> LessonStore:
    """Replace the global lesson store (tests only)."""
    global _default_lesson_store
    with _default_lesson_lock:
        if path is None:
            store = object.__new__(LessonStore)
            store.path = Path("/tmp/bb-harness-lessons-test.json")
            store._lock = threading.RLock()
            store._lessons = []
            _default_lesson_store = store
        else:
            _default_lesson_store = LessonStore(path=path)
        return _default_lesson_store
