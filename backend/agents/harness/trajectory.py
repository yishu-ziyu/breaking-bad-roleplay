"""Trajectory logging for BB Agent Harness (ch6).

In-memory store with optional JSONL persistence under harness/data/.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# Default JSONL path next to this package
_DEFAULT_JSONL = (
    Path(__file__).resolve().parent / "data" / "trajectories.jsonl"
)


@dataclass
class TrajectoryEvent:
    """A single event on an agent run trajectory."""

    type: str
    timestamp: float = field(default_factory=lambda: time.time())
    data: dict[str, Any] = field(default_factory=dict)
    step: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "timestamp": self.timestamp,
            "data": self.data,
            "step": self.step,
        }


@dataclass
class TrajectoryRecord:
    """Full record for one run_id."""

    run_id: str
    meta: dict[str, Any] = field(default_factory=dict)
    events: list[TrajectoryEvent] = field(default_factory=list)
    started_at: float = field(default_factory=lambda: time.time())
    finished_at: float | None = None
    result_summary: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "meta": self.meta,
            "events": [e.to_dict() for e in self.events],
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "result_summary": self.result_summary,
        }

    def public_view(self) -> dict[str, Any]:
        """Redacted view for unauthenticated list APIs — no user text."""
        return {
            "run_id": self.run_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "event_count": len(self.events),
            "stopped_reason": (self.result_summary or {}).get("stopped_reason"),
            "character_id": (self.meta or {}).get("character_id"),
            "mode": (self.meta or {}).get("mode"),
            "offline": (self.meta or {}).get("offline"),
        }


class TrajectoryStore:
    """In-memory trajectory store with optional JSONL append-on-finish."""

    def __init__(self, jsonl_path: Path | str | None = _DEFAULT_JSONL) -> None:
        self._lock = threading.RLock()
        self._runs: dict[str, TrajectoryRecord] = {}
        self._order: list[str] = []  # insertion order for list_recent
        self.jsonl_path = Path(jsonl_path) if jsonl_path else None

    def start(self, run_id: str, meta: dict[str, Any] | None = None) -> TrajectoryRecord:
        """Begin a trajectory for ``run_id`` (overwrites if re-started)."""
        rid = str(run_id).strip()
        if not rid:
            raise ValueError("run_id is required")
        with self._lock:
            rec = TrajectoryRecord(run_id=rid, meta=dict(meta or {}))
            self._runs[rid] = rec
            if rid in self._order:
                self._order.remove(rid)
            self._order.append(rid)
            return rec

    def append(self, run_id: str, event: TrajectoryEvent | dict[str, Any]) -> None:
        """Append an event to an existing run."""
        rid = str(run_id).strip()
        with self._lock:
            rec = self._runs.get(rid)
            if rec is None:
                rec = TrajectoryRecord(run_id=rid)
                self._runs[rid] = rec
                self._order.append(rid)
            if isinstance(event, TrajectoryEvent):
                ev = event
            else:
                ev = TrajectoryEvent(
                    type=str(event.get("type") or "event"),
                    timestamp=float(event.get("timestamp") or time.time()),
                    data=dict(event.get("data") or {}),
                    step=event.get("step"),
                )
            if ev.step is None:
                ev.step = len(rec.events)
            rec.events.append(ev)

    def finish(
        self,
        run_id: str,
        result_summary: dict[str, Any] | None = None,
    ) -> TrajectoryRecord | None:
        """Mark run finished and optionally persist to JSONL."""
        rid = str(run_id).strip()
        with self._lock:
            rec = self._runs.get(rid)
            if rec is None:
                return None
            rec.finished_at = time.time()
            rec.result_summary = dict(result_summary or {})
            self._persist(rec)
            return rec

    def get(self, run_id: str) -> TrajectoryRecord | None:
        with self._lock:
            return self._runs.get(str(run_id).strip())

    def list_recent(self, n: int = 20) -> list[TrajectoryRecord]:
        """Return up to ``n`` most recent runs (newest last)."""
        with self._lock:
            if n <= 0:
                return []
            ids = self._order[-n:]
            return [self._runs[i] for i in ids if i in self._runs]

    def _persist(self, rec: TrajectoryRecord) -> None:
        if self.jsonl_path is None:
            return
        try:
            self.jsonl_path.parent.mkdir(parents=True, exist_ok=True)
            line = json.dumps(rec.to_dict(), ensure_ascii=False)
            with self.jsonl_path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            # Persistence is best-effort; never crash the agent run.
            pass


_default_store: TrajectoryStore | None = None
_default_lock = threading.Lock()


def get_trajectory_store() -> TrajectoryStore:
    """Process-wide default TrajectoryStore (lazy singleton)."""
    global _default_store
    with _default_lock:
        if _default_store is None:
            _default_store = TrajectoryStore()
        return _default_store


def reset_trajectory_store_for_tests() -> TrajectoryStore:
    """Replace the global store (tests only)."""
    global _default_store
    with _default_lock:
        _default_store = TrajectoryStore(jsonl_path=None)
        return _default_store
