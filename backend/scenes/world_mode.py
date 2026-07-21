"""World mode: changes what "hard wrong" means (DEC-0005 correctness L3).

Canon Mode: strict timeline / knowledge / relations.
Alternate Timeline: core character policy stable; player may rewrite history.
Sandbox Mode: keep voice recognizability; freer relations and plot.
"""

from __future__ import annotations

from typing import Literal

WorldMode = Literal["canon", "alternate", "sandbox"]

_ALIASES: dict[str, WorldMode] = {
    "canon": "canon",
    "canon_mode": "canon",
    "canonical": "canon",
    "alternate": "alternate",
    "alternate_timeline": "alternate",
    "alt": "alternate",
    "branch": "alternate",
    "sandbox": "sandbox",
    "free": "sandbox",
    "sandbox_mode": "sandbox",
}


def parse_world_mode(raw: str | None, *, default: WorldMode = "alternate") -> WorldMode:
    if not raw:
        return default
    key = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    return _ALIASES.get(key, default)
