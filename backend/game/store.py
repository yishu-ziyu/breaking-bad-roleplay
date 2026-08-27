"""In-memory game store. P0 does not require a database."""

from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from typing import Any

from game.state import GameState


@dataclass
class StoredGame:
    state: GameState
    event: dict[str, Any]
    last_resolution: dict[str, Any] | None = None
    language: str = "en"


class GameStore:
    def __init__(self) -> None:
        self._games: dict[str, StoredGame] = {}
        self._lock = Lock()

    def put(self, record: StoredGame) -> StoredGame:
        with self._lock:
            self._games[record.state.game_id] = record
            return record

    def get(self, game_id: str) -> StoredGame | None:
        with self._lock:
            return self._games.get(game_id)

    def clear(self) -> None:
        with self._lock:
            self._games.clear()


game_store = GameStore()
