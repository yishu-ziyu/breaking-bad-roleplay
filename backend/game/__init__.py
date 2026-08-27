"""Deterministic Game Kernel — the only GameState writer.

P0 night: player is Walter, one night, six turns, no LLM required.
AI performance (P1) may read a ResolvedBeat; it must never write state.
"""

from game.reducer import apply_action, start_night
from game.state import GameState
from game.store import GameStore, game_store

__all__ = [
    "GameState",
    "GameStore",
    "apply_action",
    "game_store",
    "start_night",
]
