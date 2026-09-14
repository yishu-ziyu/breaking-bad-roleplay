"""Game command service. Kernel is the only writer of rule state. No LLM."""

from __future__ import annotations

import hashlib
import json
import threading
import uuid
from typing import Any

from game.kernel import apply_action, player_view, start_run, state_from_dict, state_to_dict
from game.store import GameStore


class GameError(Exception):
    def __init__(self, code: str, message: str, payload: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.payload = payload or {}


def request_hash(action_id: str, expected_revision: int, choice_id: str) -> str:
    blob = json.dumps(
        {
            "action_id": action_id,
            "expected_revision": int(expected_revision),
            "choice_id": choice_id,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class GameService:
    def __init__(self, store: GameStore):
        self.store = store
        self._lock = threading.Lock()

    def start(self, seed: int = 1, owner: str = "guest") -> dict[str, Any]:
        with self._lock, self.store.unit_of_work():
            run_id = str(uuid.uuid4())
            state = start_run(seed=seed, run_id=run_id)
            self._persist_run(
                state,
                owner=owner,
                parent_run_id=None,
                parent_revision=None,
                source_action_id=None,
                event_type="run_started",
            )
            return self._view(state)

    def get(self, run_id: str) -> dict[str, Any]:
        row = self.store.get_run(run_id)
        if row is None:
            raise GameError("not_found", "run not found")
        return self._with_performance(self._view(state_from_dict(row["state"])))

    def events(self, run_id: str, after: int = 0) -> list[dict[str, Any]]:
        if self.store.get_run(run_id) is None:
            raise GameError("not_found", "run not found")
        return self.store.list_events(run_id, after=after)

    def act(
        self,
        run_id: str,
        action_id: str,
        expected_revision: int,
        choice_id: str,
    ) -> dict[str, Any]:
        digest = request_hash(action_id, expected_revision, choice_id)
        with self._lock, self.store.unit_of_work():
            row = self.store.lock_run(run_id)
            if row is None:
                raise GameError("not_found", "run not found")
            existing = self.store.get_action(run_id, action_id)
            if existing is not None:
                if existing["request_hash"] != digest:
                    raise GameError("idempotency_mismatch", "action_id already used")
                return dict(existing["accepted_view"])
            current = int(row["revision"])
            if int(expected_revision) != current:
                raise GameError(
                    "revision_conflict",
                    "stale revision",
                    {"view": self._view(state_from_dict(row["state"]))},
                )
            state = state_from_dict(row["state"])
            nxt, err = apply_action(state, choice_id)
            if err:
                raise GameError(err, err)
            view = self._persist_run(
                nxt,
                owner=row["owner"],
                parent_run_id=row.get("parent_run_id"),
                parent_revision=row.get("parent_revision"),
                source_action_id=action_id,
                event_type="turn_committed",
            )
            self.store.put_action(
                {
                    "run_id": run_id,
                    "action_id": action_id,
                    "request_hash": digest,
                    "expected_revision": int(expected_revision),
                    "accepted_revision": nxt.revision,
                    "choice_id": choice_id,
                    "accepted_view": view,
                }
            )
            self.store.put_job(
                {
                    "id": str(uuid.uuid4()),
                    "run_id": run_id,
                    "action_id": action_id,
                    "revision": nxt.revision,
                    "status": "pending",
                    "kind": "performance",
                }
            )
            return view

    def replay(self, run_id: str, revision: int) -> dict[str, Any]:
        with self._lock, self.store.unit_of_work():
            if self.store.get_run(run_id) is None:
                raise GameError("not_found", "run not found")
            checkpoint = self.store.get_checkpoint(run_id, int(revision))
            if checkpoint is None:
                raise GameError("not_found", "checkpoint not found")
            job = {
                "id": str(uuid.uuid4()),
                "run_id": run_id,
                "action_id": checkpoint.get("source_action_id"),
                "revision": int(revision),
                "status": "pending",
                "kind": "performance_replay",
            }
            self.store.put_job(job)
            self.store.append_event(
                {
                    "run_id": run_id,
                    "revision": int(revision),
                    "type": "performance_queued",
                    "visibility": "player",
                    "source_action_id": checkpoint.get("source_action_id"),
                    "payload": {"job_id": job["id"], "replay": True},
                }
            )
            return {"job_id": job["id"], "revision": int(revision), "status": "pending"}

    def branch(self, run_id: str, revision: int) -> dict[str, Any]:
        with self._lock, self.store.unit_of_work():
            row = self.store.get_run(run_id)
            if row is None:
                raise GameError("not_found", "run not found")
            checkpoint = self.store.get_checkpoint(run_id, int(revision))
            if checkpoint is None:
                raise GameError("not_found", "checkpoint not found")
            child_id = str(uuid.uuid4())
            state = state_from_dict(checkpoint["state"])
            state.run_id = child_id
            return self._persist_run(
                state,
                owner=row.get("owner") or "guest",
                parent_run_id=run_id,
                parent_revision=int(revision),
                source_action_id=None,
                event_type="run_branched",
            )

    def _persist_run(
        self,
        state,
        *,
        owner: str,
        parent_run_id: str | None,
        parent_revision: int | None,
        source_action_id: str | None,
        event_type: str,
    ) -> dict[str, Any]:
        snapshot = state_to_dict(state)
        view = self._view(state)
        self.store.put_run(
            {
                "id": state.run_id,
                "owner": owner,
                "scenario_id": "one_night_v1",
                "rules_version": 1,
                "seed": state.seed,
                "revision": state.revision,
                "status": "ended" if state.ending else "active",
                "state": snapshot,
                "parent_run_id": parent_run_id,
                "parent_revision": parent_revision,
            }
        )
        self.store.put_checkpoint(
            {
                "run_id": state.run_id,
                "revision": state.revision,
                "state": snapshot,
                "seed": state.seed,
                "owner": owner,
                "parent_run_id": parent_run_id,
                "source_action_id": source_action_id,
            }
        )
        self.store.append_event(
            {
                "run_id": state.run_id,
                "revision": state.revision,
                "type": event_type,
                "visibility": "player",
                "source_action_id": source_action_id,
                "payload": {
                    "turn": view["turn"],
                    "location": view["location"],
                    "ending_id": (view["ending"] or {}).get("id") if view["ending"] else None,
                },
            }
        )
        return view

    def _with_performance(self, view: dict[str, Any]) -> dict[str, Any]:
        match = None
        for item in self.store.list_events(view["run_id"], after=0):
            if item.get("revision") == view["revision"] and item.get("type") in {
                "performance_ready",
                "performance_fallback",
            }:
                match = item
        if match is None:
            return view
        payload = match.get("payload") or {}
        out = dict(view)
        out["line"] = payload.get("line")
        out["performance"] = {
            "status": payload.get("status")
            or ("fallback" if match["type"] == "performance_fallback" else "ready"),
            "line": payload.get("line"),
            "speaker": payload.get("speaker"),
            "used_fallback": bool(payload.get("used_fallback")),
        }
        return out

    @staticmethod
    def _view(state) -> dict[str, Any]:
        view = player_view(state)
        view["visibility"] = "player"
        return view
