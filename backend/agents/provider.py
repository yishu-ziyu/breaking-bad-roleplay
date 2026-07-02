import httpx
from pathlib import Path
from typing import Literal
from config import settings


class ProviderFacade:
    """
    Unified interface for MiniMax (Anthropic-compatible) and
    StepFun (OpenAI-compatible) LLM providers.

    Usage:
        provider = ProviderFacade(settings)
        reply = await provider.call_model(
            messages=[{"role": "user", "content": "Hello"}],
            model_route="minimax/MiniMax-M3",
        )
    """

    def __init__(self, settings=None):
        if settings is None:
            from config import settings as _settings
            settings = _settings
        self.minimax_key = settings.minimax_api_key
        self.stepfun_key = settings.stepfun_api_key
        self.cli_proxy_base_url = settings.cli_proxy_base_url.rstrip("/")
        self.cli_proxy_key = settings.cli_proxy_api_key or self._load_cli_proxy_api_key()
        self.cli_proxy_default_model = settings.cli_proxy_default_model
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0)
        )

    def _load_cli_proxy_api_key(self) -> str:
        config_path = Path.home() / ".cli-proxy-api" / "config.yaml"
        if not config_path.exists():
            return ""
        in_api_keys = False
        for line in config_path.read_text(encoding="utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if stripped == "api-keys:":
                in_api_keys = True
                continue
            if not in_api_keys:
                continue
            if stripped.startswith("- "):
                return stripped[2:].strip().strip('"').strip("'")
            if stripped and not line.startswith(" "):
                return ""
        return ""

    async def call_model(
        self,
        messages: list[dict],
        model_route: str,
        max_tokens: int = 4096,
    ) -> str:
        """
        Send a chat completion request to the appropriate provider.

        Args:
            messages: List of {"role": ..., "content": ...} dicts.
            model_route: "minimax/<model>" or "stepfun/<model>".
            max_tokens: Max tokens to generate (MiniMax only; StepFun ignores).

        Returns:
            The assistant's reply text.

        Raises:
            ValueError: If provider prefix is unrecognised.
            httpx.HTTPStatusError: On non-2xx responses.
        """
        if "/" not in model_route:
            raise ValueError(
                f"Invalid model_route '{model_route}'. Expected 'provider/model'."
            )
        provider, model = model_route.split("/", 1)
        if provider == "minimax":
            return await self._call_minimax(messages, model, max_tokens)
        if provider == "stepfun":
            try:
                return await self._call_stepfun(messages, model)
            except httpx.HTTPStatusError:
                if not self.minimax_key:
                    raise
                return await self._call_minimax(messages, "MiniMax-M3", max_tokens)
        if provider == "cliproxy":
            return await self._call_cli_proxy(messages, model, max_tokens)
        raise ValueError(f"Unknown provider '{provider}'. Use 'minimax', 'stepfun', or 'cliproxy'.")

    async def _call_minimax(
        self, messages: list[dict], model: str, max_tokens: int
    ) -> str:
        resp = await self._client.post(
            "https://api.minimaxi.com/anthropic/v1/messages",
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": self.minimax_key,
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "messages": messages,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            error_msg = data["error"].get("message", str(data["error"]))
            raise RuntimeError(f"MiniMax API error: {error_msg}")
        # Anthropic-compatible response: content is a list of blocks
        content_blocks = data.get("content", [])
        if not content_blocks:
            raise RuntimeError(f"MiniMax API returned no content blocks: {data}")
        content = "".join(
            block.get("text", "") for block in content_blocks if block.get("type") == "text"
        )
        if not content:
            raise RuntimeError(f"MiniMax API returned empty content: {data}")
        return content

    async def _call_stepfun(self, messages: list[dict], model: str) -> str:
        resp = await self._client.post(
            "https://api.stepfun.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self.stepfun_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        # OpenAI-compatible response
        if "error" in data:
            error_msg = data["error"].get("message", str(data["error"]))
            raise RuntimeError(f"StepFun API error: {error_msg}")
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError(f"StepFun API returned no choices: {data}")
        content = choices[0].get("message", {}).get("content", "")
        if not content:
            raise RuntimeError(f"StepFun API returned empty content: {data}")
        return content

    async def _call_cli_proxy(
        self, messages: list[dict], model: str, max_tokens: int
    ) -> str:
        if not self.cli_proxy_key:
            raise RuntimeError("CLIProxy API key is not configured")

        system_parts: list[str] = []
        anthropic_messages: list[dict] = []
        for message in messages:
            role = message.get("role")
            content = message.get("content", "")
            if role == "system":
                system_parts.append(str(content))
            elif role in ("user", "assistant"):
                anthropic_messages.append({"role": role, "content": str(content)})

        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": anthropic_messages,
        }
        if system_parts:
            payload["system"] = "\n\n".join(system_parts)

        resp = await self._client.post(
            f"{self.cli_proxy_base_url}/v1/messages",
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": self.cli_proxy_key,
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            error = data["error"]
            if isinstance(error, dict):
                error_msg = error.get("message", str(error))
            else:
                error_msg = str(error)
            raise RuntimeError(f"CLIProxy API error: {error_msg}")

        content_blocks = data.get("content", [])
        content = "".join(
            str(block.get("text") or block.get("thinking") or "")
            for block in content_blocks
            if block.get("type") in ("text", "thinking")
        )
        if not content:
            raise RuntimeError(f"CLIProxy API returned empty content: {data}")
        return content

    async def close(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------
    # Scene-level model routing
    # ------------------------------------------------------------------


    def resolve_model_route(
        self,
        scene_context: str,
        characters: list[str],
    ) -> str:
        """
        Chat defaults to CLIProxy for local development. The frontend can
        still override the provider prefix for Direct/Crew chat.
        """
        return f"cliproxy/{self.cli_proxy_default_model}"
