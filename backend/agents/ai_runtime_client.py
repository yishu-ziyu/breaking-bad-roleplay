"""Internal client for the Node ai-runtime sidecar.

Never writes GameState. Failures return None so the kernel path can fall back.
"""

from __future__ import annotations

from typing import Any, AsyncIterator
import logging

import httpx

logger = logging.getLogger(__name__)


class AiRuntimeClient:
    def __init__(self, base_url: str, timeout_ms: int = 20_000) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout_ms / 1000.0

    async def health(self) -> dict[str, Any] | None:
        try:
            async with httpx.AsyncClient(timeout=2.0, trust_env=False) as client:
                resp = await client.get(f"{self.base_url}/internal/health")
            if resp.status_code != 200:
                return None
            return resp.json()
        except Exception:
            return None

    async def perform(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        try:
            async with httpx.AsyncClient(timeout=self.timeout, trust_env=False) as client:
                resp = await client.post(f"{self.base_url}/perform", json=payload)
            if resp.status_code != 200:
                logger.warning("ai-runtime perform failed status=%s", resp.status_code)
                return None
            body = resp.json()
            if any(key in body for key in (
                "game_state_delta",
                "score_delta",
                "objective_delta",
                "debt_delta",
                "world_truth_delta",
            )):
                logger.warning("ai-runtime returned forbidden state keys; dropping")
                return None
            if not body.get("reply_text"):
                return None
            return body
        except Exception:
            logger.warning("ai-runtime perform crashed; using fallback", exc_info=True)
            return None

    async def stream(self, payload: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout, trust_env=False) as client:
                async with client.stream("POST", f"{self.base_url}/perform/stream", json=payload) as resp:
                    event_name = "message"
                    async for line in resp.aiter_lines():
                        if line.startswith("event:"):
                            event_name = line.split(":", 1)[1].strip()
                            if event_name == "thinking" or event_name == "thinking_delta":
                                event_name = "drop"
                            continue
                        if line.startswith("data:"):
                            if event_name == "drop":
                                continue
                            yield {"type": event_name, "data": line.split(":", 1)[1].strip()}
        except Exception:
            logger.warning("ai-runtime stream failed", exc_info=True)
            return

    async def dispose(self, game_id: str) -> None:
        try:
            async with httpx.AsyncClient(timeout=2.0, trust_env=False) as client:
                await client.post(f"{self.base_url}/dispose", json={"game_id": game_id})
        except Exception:
            logger.info("ai-runtime dispose skipped")
