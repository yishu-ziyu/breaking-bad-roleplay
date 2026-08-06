"""Correction primitives for the agent harness: circuit breaker, retry, loop detect."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Awaitable, Callable


class CircuitBreaker:
    """Opens after ``failure_threshold`` consecutive failures; half-open after timeout.

    When open, callers should refuse new work (``is_open`` is True) until
    ``reset_timeout_s`` elapses, after which a success re-closes the breaker.
    """

    def __init__(
        self,
        *,
        failure_threshold: int = 3,
        reset_timeout_s: float = 60.0,
    ) -> None:
        self.failure_threshold = failure_threshold
        self.reset_timeout_s = reset_timeout_s
        self._failures = 0
        self._opened_at: float | None = None

    def record_success(self) -> None:
        self._failures = 0
        self._opened_at = None

    def record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self.failure_threshold and self._opened_at is None:
            self._opened_at = time.monotonic()

    @property
    def is_open(self) -> bool:
        if self._opened_at is None:
            return False
        elapsed = time.monotonic() - self._opened_at
        if elapsed >= self.reset_timeout_s:
            # Half-open: allow one attempt. Stay open until success or next fail.
            return False
        return True


async def with_retry(
    coro_factory: Callable[[], Awaitable[Any]],
    *,
    max_attempts: int = 3,
    backoff_s: float = 0.05,
) -> Any:
    """Run ``coro_factory`` up to ``max_attempts`` times with linear backoff.

    ``coro_factory`` is a zero-arg callable that returns a fresh awaitable each
    attempt (so failed coroutines are not re-awaited).
    """
    last_exc: BaseException | None = None
    for attempt in range(max_attempts):
        try:
            return await coro_factory()
        except Exception as exc:  # noqa: BLE001 - surface after retries
            last_exc = exc
            if attempt + 1 >= max_attempts:
                break
            await asyncio.sleep(backoff_s * (attempt + 1))
    assert last_exc is not None
    raise last_exc


def tool_call_signature(name: str, arguments: dict | None = None) -> str:
    """Stable signature for a tool call: ``name`` + sorted JSON args."""
    try:
        args_s = json.dumps(arguments or {}, sort_keys=True, ensure_ascii=False)
    except (TypeError, ValueError):
        args_s = str(arguments)
    return f"{name}:{args_s}"


def detect_repeated_tool_loop(
    signature_history: list[str],
    window: int = 3,
) -> bool:
    """True when the last ``window`` signatures are identical and non-empty.

    Used to break infinite tool-call cycles where the model keeps requesting
    the same tool with the same arguments.
    """
    if window < 1 or len(signature_history) < window:
        return False
    recent = signature_history[-window:]
    first = recent[0]
    if not first:
        return False
    return all(s == first for s in recent)
