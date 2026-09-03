"""GameState and meter bounds. Reducer is the only writer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import copy
import uuid

METER_MIN = 0
METER_MAX = 6
MAX_TURNS = 6


def clamp_int(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(value)))


@dataclass
class GameState:
    game_id: str
    seed: int
    turn: int = 0
    police_risk: int = 2
    family_suspicion: int = 2
    jesse_trust: int = 3
    cash: int = 400
    saul_favor: int = 1
    open_problems: list[str] = field(default_factory=list)
    debts: list[dict[str, Any]] = field(default_factory=list)
    npc_state: dict[str, dict[str, Any]] = field(default_factory=dict)
    objective_state: dict[str, str] = field(default_factory=dict)
    flags: set[str] = field(default_factory=set)
    rng_counter: int = 0
    ended: bool = False
    ending: dict[str, Any] | None = None

    @classmethod
    def new(cls, seed: int, game_id: str | None = None) -> GameState:
        return cls(
            game_id=game_id or uuid.uuid4().hex,
            seed=int(seed),
            turn=0,
            police_risk=2,
            family_suspicion=2,
            jesse_trust=3,
            cash=400,
            saul_favor=1,
            open_problems=["rv_evidence", "hank_voicemail"],
            debts=[],
            npc_state={
                "jesse": {"location": "rv", "mood": "panicked", "gone": False},
                "hank": {"location": "office", "heat": 1, "gone": False},
                "skyler": {"location": "home", "asking": True, "gone": False},
                "saul": {"location": "office", "mood": "available", "gone": False},
            },
            objective_state={
                "survive_dawn": "active",
                "contain_rv": "open",
                "keep_family": "active",
            },
            flags=set(),
            rng_counter=0,
            ended=False,
            ending=None,
        )

    def clone(self) -> GameState:
        return copy.deepcopy(self)

    def with_updates(self, **kwargs: Any) -> GameState:
        nxt = self.clone()
        for key, value in kwargs.items():
            if not hasattr(nxt, key):
                raise AttributeError(key)
            setattr(nxt, key, copy.deepcopy(value) if isinstance(value, (list, dict, set)) else value)
        return nxt

    def visible(self) -> dict[str, Any]:
        """What a performer or player is allowed to see — never a write handle."""
        return {
            "turn": self.turn,
            "max_turns": MAX_TURNS,
            "police_risk": self.police_risk,
            "family_suspicion": self.family_suspicion,
            "jesse_trust": self.jesse_trust,
            "cash": self.cash,
            "saul_favor": self.saul_favor,
            "open_problems": list(self.open_problems),
            "debts": [
                {
                    "id": d["id"],
                    "countdown": d.get("countdown"),
                    "severity": d.get("severity"),
                    "exposed_to": d.get("exposed_to", []),
                }
                for d in self.debts
            ],
            "npc_state": copy.deepcopy(self.npc_state),
            "objective_state": dict(self.objective_state),
            "flags": sorted(self.flags),
            "ended": self.ended,
            "ending": copy.deepcopy(self.ending),
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "game_id": self.game_id,
            "seed": self.seed,
            "turn": self.turn,
            "police_risk": self.police_risk,
            "family_suspicion": self.family_suspicion,
            "jesse_trust": self.jesse_trust,
            "cash": self.cash,
            "saul_favor": self.saul_favor,
            "open_problems": list(self.open_problems),
            "debts": copy.deepcopy(self.debts),
            "npc_state": copy.deepcopy(self.npc_state),
            "objective_state": dict(self.objective_state),
            "flags": sorted(self.flags),
            "rng_counter": self.rng_counter,
            "ended": self.ended,
            "ending": copy.deepcopy(self.ending),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GameState:
        payload = copy.deepcopy(data)
        flags = payload.get("flags") or []
        payload["flags"] = set(flags)
        payload.setdefault("rng_counter", 0)
        payload.setdefault("ended", False)
        payload.setdefault("ending", None)
        return cls(**payload)


def clamp_meters(state: GameState) -> GameState:
    nxt = state.clone()
    nxt.police_risk = clamp_int(nxt.police_risk, METER_MIN, METER_MAX)
    nxt.family_suspicion = clamp_int(nxt.family_suspicion, METER_MIN, METER_MAX)
    nxt.jesse_trust = clamp_int(nxt.jesse_trust, METER_MIN, METER_MAX)
    nxt.cash = max(0, int(nxt.cash))
    return nxt
