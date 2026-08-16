import logging

import httpx
from dataclasses import dataclass
from pathlib import Path
from agents.credential_context import get_credential_override
from agents.byok_presets import preset_by_id
from agents.tools import (
    Tool,
    ToolCall,
    translate_tools_to_anthropic,
    translate_tools_to_openai,
    parse_tool_calls_anthropic,
    parse_tool_calls_openai,
)

logger = logging.getLogger(__name__)

MINIMAX_HOST_CN = "https://api.minimaxi.com"
MINIMAX_HOST_GLOBAL = "https://api.minimax.io"
STEPFUN_HOST = "https://api.stepfun.com"


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

    def __init__(self, settings=None, use_litellm: bool = False):
        self.use_litellm = use_litellm
        if use_litellm:
            try:
                from agents.litellm_patch import patch_litellm
                patch_litellm()
            except Exception:
                logger.warning("Failed to apply LiteLLM patches, continuing without them", exc_info=True)
        if settings is None:
            from config import settings as _settings
            settings = _settings
        self.minimax_key = settings.minimax_api_key
        self.stepfun_key = settings.stepfun_api_key
        self.cli_proxy_base_url = settings.cli_proxy_base_url.rstrip("/")
        self.cli_proxy_key = settings.cli_proxy_api_key or self._load_cli_proxy_api_key()
        self.cli_proxy_default_model = settings.cli_proxy_default_model
        # trust_env=False disables env-level proxies (e.g. Clash socks5h) which
        # httpx cannot parse. The cli-proxy is reached via explicit base_url.
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0),
            trust_env=False,
            follow_redirects=False,
        )
        self.app_env = getattr(settings, "app_env", "development")

    # ------------------------------------------------------------------
    # BYOK-aware credential helpers (request ContextVar first, env fallback)
    # ------------------------------------------------------------------

    def effective_minimax_llm_key(self) -> str:
        ov = get_credential_override()
        if ov and ov.provider_id == "minimax" and ov.llm_key:
            return ov.llm_key
        if ov and ov.llm_key and ov.provider_id in (None, "", "minimax"):
            return ov.llm_key
        return self.minimax_key

    def effective_minimax_tts_key(self) -> str:
        ov = get_credential_override()
        if ov and ov.tts_key:
            return ov.tts_key
        if ov and ov.provider_id == "minimax" and ov.llm_key:
            return ov.llm_key
        return self.minimax_key

    def effective_stepfun_key(self) -> str:
        ov = get_credential_override()
        if ov and ov.provider_id == "stepfun" and ov.llm_key:
            return ov.llm_key
        return self.stepfun_key

    def effective_cli_proxy_key(self) -> str:
        ov = get_credential_override()
        if ov and ov.provider_id == "cliproxy" and ov.llm_key:
            return ov.llm_key
        return self.cli_proxy_key

    def effective_cli_proxy_base_url(self) -> str:
        ov = get_credential_override()
        if ov and ov.provider_id == "cliproxy" and ov.base_url:
            return ov.base_url.rstrip("/")
        return self.cli_proxy_base_url

    def effective_minimax_host(self) -> str:
        ov = get_credential_override()
        region = (ov.region if ov else None) or "cn"
        if region == "global":
            return MINIMAX_HOST_GLOBAL
        return MINIMAX_HOST_CN

    def effective_byok_key(self, provider_id: str) -> str:
        """Key for a BYOK preset (or matching override)."""
        ov = get_credential_override()
        if ov and ov.llm_key and (
            ov.provider_id == provider_id
            or (not ov.provider_id and provider_id in ("minimax", "stepfun"))
        ):
            return ov.llm_key
        # Platform env fallback only for the two demo providers.
        if provider_id == "minimax":
            return self.minimax_key
        if provider_id == "stepfun":
            return self.stepfun_key
        return ""

    def effective_byok_base_url(self, provider_id: str) -> str:
        """Resolve OpenAI/Anthropic base URL for a provider preset."""
        ov = get_credential_override()
        if ov and ov.provider_id == provider_id and ov.base_url:
            return ov.base_url.rstrip("/")
        preset = preset_by_id(provider_id)
        if preset and preset.get("defaultBaseUrl"):
            return str(preset["defaultBaseUrl"]).rstrip("/")
        if provider_id == "stepfun":
            return f"{STEPFUN_HOST}/v1"
        if provider_id == "minimax":
            return f"{self.effective_minimax_host()}/anthropic/v1"
        return ""

    def _byok_kind(self, provider_id: str) -> str:
        preset = preset_by_id(provider_id)
        if preset and preset.get("kind"):
            return str(preset["kind"])
        if provider_id == "minimax":
            return "anthropic"
        return "openai"

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

        # LiteLLM fast path — when enabled, try it first and fall back on failure.
        if self.use_litellm:
            try:
                return await self._call_litellm(messages, model_route, max_tokens)
            except Exception as exc:
                logger.warning("LiteLLM call failed, falling back to direct provider: %s", exc)

        if provider == "minimax":
            return await self._call_minimax(messages, model, max_tokens)
        if provider == "stepfun":
            try:
                return await self._call_stepfun(messages, model)
            except httpx.HTTPStatusError as exc:
                if not self.effective_minimax_llm_key():
                    raise
                # Platform StepFun quota/outage: fall back to MiniMax.
                # Log status so ops can see route drift vs UI chip.
                logger.warning(
                    "stepfun route failed HTTP %s; falling back to minimax/MiniMax-M3",
                    getattr(exc.response, "status_code", "?"),
                )
                return await self._call_minimax(messages, "MiniMax-M3", max_tokens)
        if provider == "cliproxy":
            return await self._call_cli_proxy(messages, model, max_tokens)
        # Generic BYOK presets (OpenAI-compatible or Anthropic-compatible).
        if preset_by_id(provider):
            return await self._call_byok(messages, provider, model, max_tokens)
        raise ValueError(
            f"Unknown provider '{provider}'. Use a catalog preset id "
            "(minimax, stepfun, deepseek, openai, ...)."
        )

    async def _call_minimax(
        self, messages: list[dict], model: str, max_tokens: int
    ) -> str:
        key = self.effective_minimax_llm_key()
        if not key:
            raise RuntimeError("MiniMax API key is not configured")
        resp = await self._client.post(
            f"{self.effective_minimax_host()}/anthropic/v1/messages",
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": key,
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
        key = self.effective_stepfun_key()
        if not key:
            raise RuntimeError("StepFun API key is not configured")
        resp = await self._client.post(
            f"{STEPFUN_HOST}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
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
        key = self.effective_cli_proxy_key()
        if not key:
            raise RuntimeError("CLIProxy API key is not configured")

        system_parts, anthropic_messages = _split_anthropic_messages(messages)

        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": anthropic_messages,
        }
        if system_parts:
            payload["system"] = "\n\n".join(system_parts)

        resp = await self._client.post(
            f"{self.effective_cli_proxy_base_url()}/v1/messages",
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": key,
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

    async def _call_litellm(
        self,
        messages: list[dict],
        model_route: str,
        max_tokens: int = 4096,
    ) -> str:
        """Use LiteLLM for provider-agnostic model calling.

        Falls back to the caller on any exception (connection error, bad
        route, etc.) so the existing direct-provider code path is always
        available as a safety net.

        Args:
            messages: List of {"role": ..., "content": ...} dicts.
            model_route: LiteLLM-native model string, e.g. "openai/gpt-4",
                "anthropic/claude-3-sonnet", "minimax/MiniMax-M3".
            max_tokens: Max tokens to generate.

        Returns:
            The assistant's reply text.
        """
        try:
            import litellm
            from litellm import acompletion
        except ImportError:
            raise RuntimeError(
                "litellm is not installed. Run: uv add litellm or pip install litellm"
            )

        response = await acompletion(
            model=model_route,
            messages=messages,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content

    async def close(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------
    # Scene-level model routing
    # ------------------------------------------------------------------



    async def _call_byok(
        self, messages: list[dict], provider_id: str, model: str, max_tokens: int
    ) -> str:
        kind = self._byok_kind(provider_id)
        if kind == "anthropic":
            return await self._call_openai_or_anthropic_byok(
                messages, provider_id, model, max_tokens, kind="anthropic"
            )
        return await self._call_openai_or_anthropic_byok(
            messages, provider_id, model, max_tokens, kind="openai"
        )

    async def _call_openai_or_anthropic_byok(
        self,
        messages: list[dict],
        provider_id: str,
        model: str,
        max_tokens: int,
        *,
        kind: str,
    ) -> str:
        key = self.effective_byok_key(provider_id)
        if not key:
            raise RuntimeError(f"{provider_id} API key is not configured")
        base = self.effective_byok_base_url(provider_id)
        if not base:
            raise RuntimeError(f"{provider_id} base URL is not configured")
        from agents.outbound_url import UnsafeOutboundURL, validate_outbound_base_url

        try:
            base = validate_outbound_base_url(
                base,
                allow_loopback=(
                    provider_id == "cliproxy" and self.app_env != "production"
                ),
            )
        except UnsafeOutboundURL as exc:
            raise RuntimeError(str(exc)) from exc

        if kind == "anthropic":
            # base should already include /v1 (or vendor anthropic path)
            url = f"{base}/messages" if not base.endswith("/messages") else base
            # If base is .../v1, append /messages; if already ends with anthropic/v1, same.
            if not url.endswith("/messages"):
                url = f"{base.rstrip('/')}/messages"
            resp = await self._client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                    "x-api-key": key,
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
                error = data["error"]
                error_msg = error.get("message", str(error)) if isinstance(error, dict) else str(error)
                raise RuntimeError(f"{provider_id} API error: {error_msg}")
            content_blocks = data.get("content", [])
            content = "".join(
                block.get("text", "")
                for block in content_blocks
                if isinstance(block, dict) and block.get("type") == "text"
            )
            if not content:
                raise RuntimeError(f"{provider_id} API returned empty content: {data}")
            return content

        # OpenAI-compatible
        url = f"{base}/chat/completions" if not base.endswith("/chat/completions") else base
        if not url.endswith("/chat/completions"):
            url = f"{base.rstrip('/')}/chat/completions"
        resp = await self._client.post(
            url,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            error = data["error"]
            error_msg = error.get("message", str(error)) if isinstance(error, dict) else str(error)
            raise RuntimeError(f"{provider_id} API error: {error_msg}")
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError(f"{provider_id} API returned no choices: {data}")
        content = choices[0].get("message", {}).get("content", "") or ""
        if not content:
            raise RuntimeError(f"{provider_id} API returned empty content: {data}")
        return content

    async def _call_byok_with_tools(
        self,
        messages: list[dict],
        provider_id: str,
        model: str,
        tools: list[Tool],
        tool_choice: str,
        max_tokens: int,
    ) -> "ModelResult":
        kind = self._byok_kind(provider_id)
        key = self.effective_byok_key(provider_id)
        if not key:
            raise RuntimeError(f"{provider_id} API key is not configured")
        base = self.effective_byok_base_url(provider_id)
        if not base:
            raise RuntimeError(f"{provider_id} base URL is not configured")
        from agents.outbound_url import UnsafeOutboundURL, validate_outbound_base_url

        try:
            base = validate_outbound_base_url(
                base,
                allow_loopback=(
                    provider_id == "cliproxy" and self.app_env != "production"
                ),
            )
        except UnsafeOutboundURL as exc:
            raise RuntimeError(str(exc)) from exc

        if kind == "anthropic":
            url = f"{base.rstrip('/')}/messages"
            resp = await self._client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                    "x-api-key": key,
                },
                json={
                    "model": model,
                    "max_tokens": max_tokens,
                    **({"tools": translate_tools_to_anthropic(tools)} if tools else {}),
                    "messages": messages,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                error = data["error"]
                error_msg = error.get("message", str(error)) if isinstance(error, dict) else str(error)
                raise RuntimeError(f"{provider_id} API error: {error_msg}")
            return _model_result_from_anthropic(data)

        url = f"{base.rstrip('/')}/chat/completions"
        resp = await self._client.post(
            url,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                **(
                    {
                        "tools": translate_tools_to_openai(tools),
                        "tool_choice": tool_choice,
                    }
                    if tools
                    else {}
                ),
                "messages": messages,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            error = data["error"]
            error_msg = error.get("message", str(error)) if isinstance(error, dict) else str(error)
            raise RuntimeError(f"{provider_id} API error: {error_msg}")
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError(f"{provider_id} API returned no choices: {data}")
        message = choices[0].get("message", {}) or {}
        return _model_result_from_openai(message)

    def resolve_model_route(
        self,
        scene_context: str,
        characters: list[str],
    ) -> str:
        """Default public route: StepFun 3.7 Flash. Frontend may override."""
        return "stepfun/step-3.7-flash"

    # ------------------------------------------------------------------
    # Native function-calling support (DEC-0001 / ARCH-DESIGN-function-calling)
    # ------------------------------------------------------------------

    async def call_model_with_tools(
        self,
        messages: list[dict],
        model_route: str,
        tools: list[Tool],
        tool_choice: str = "auto",
        max_tokens: int = 4096,
    ) -> "ModelResult":
        """Call a model with native function-calling tools.

        Returns a :class:`ModelResult` carrying the final text and/or a list of
        ``ToolCall`` requests. When the model requests tools the caller must
        execute them and feed results back (see the tool loop in
        ``ARCH-DESIGN-function-calling.md``). ``call_model`` (text-only) is
        unchanged, so non-tool paths keep working.
        """
        if "/" not in model_route:
            raise ValueError(
                f"Invalid model_route '{model_route}'. Expected 'provider/model'."
            )
        provider, model = model_route.split("/", 1)
        if provider == "minimax":
            return await self._call_minimax_with_tools(messages, model, tools, max_tokens)
        if provider == "stepfun":
            try:
                return await self._call_stepfun_with_tools(messages, model, tools, tool_choice)
            except httpx.HTTPStatusError:
                if not self.effective_minimax_llm_key():
                    raise
                return await self._call_minimax_with_tools(messages, "MiniMax-M3", tools, max_tokens)
        if provider == "cliproxy":
            return await self._call_cli_proxy_with_tools(messages, model, tools, max_tokens)
        if preset_by_id(provider):
            return await self._call_byok_with_tools(
                messages, provider, model, tools, tool_choice, max_tokens
            )
        raise ValueError(
            f"Unknown provider '{provider}'. Use a catalog preset id "
            "(minimax, stepfun, deepseek, openai, ...)."
        )

    async def _call_minimax_with_tools(
        self, messages: list[dict], model: str, tools: list[Tool], max_tokens: int
    ) -> "ModelResult":
        key = self.effective_minimax_llm_key()
        if not key:
            raise RuntimeError("MiniMax API key is not configured")
        resp = await self._client.post(
            f"{self.effective_minimax_host()}/anthropic/v1/messages",
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": key,
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                **({"tools": translate_tools_to_anthropic(tools)} if tools else {}),
                "messages": messages,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise RuntimeError(f"MiniMax API error: {data['error'].get('message', str(data['error']))}")
        return _model_result_from_anthropic(data)

    async def _call_stepfun_with_tools(
        self, messages: list[dict], model: str, tools: list[Tool], tool_choice: str
    ) -> "ModelResult":
        key = self.effective_stepfun_key()
        if not key:
            raise RuntimeError("StepFun API key is not configured")
        resp = await self._client.post(
            f"{STEPFUN_HOST}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                **(
                    {
                        "tools": translate_tools_to_openai(tools),
                        "tool_choice": tool_choice,
                    }
                    if tools
                    else {}
                ),
                "messages": messages,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise RuntimeError(f"StepFun API error: {data['error'].get('message', str(data['error']))}")
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError(f"StepFun API returned no choices: {data}")
        return _model_result_from_openai(choices[0].get("message", {}))

    async def _call_cli_proxy_with_tools(
        self, messages: list[dict], model: str, tools: list[Tool], max_tokens: int
    ) -> "ModelResult":
        key = self.effective_cli_proxy_key()
        if not key:
            raise RuntimeError("CLIProxy API key is not configured")
        system_parts, anthropic_messages = _split_anthropic_messages(messages)
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": anthropic_messages,
        }
        if tools:
            payload["tools"] = translate_tools_to_anthropic(tools)
        if system_parts:
            payload["system"] = "\n\n".join(system_parts)
        resp = await self._client.post(
            f"{self.effective_cli_proxy_base_url()}/v1/messages",
            headers={
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": key,
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            error = data["error"]
            error_msg = error.get("message", str(error)) if isinstance(error, dict) else str(error)
            raise RuntimeError(f"CLIProxy API error: {error_msg}")
        return _model_result_from_anthropic(data)


def _split_anthropic_messages(messages: list[dict]) -> tuple[list[str], list[dict]]:
    """Convert an internal message list into Anthropic (CLIProxy) wire form.

    Preserves block-array ``content`` (text + tool_use / tool_result blocks)
    instead of flattening it with ``str()`` — required for native tool loops.
    OpenAI-style ``{"role": "tool", ...}`` messages are folded into the
    preceding user turn as ``tool_result`` blocks, which is what Anthropic
    expects (a bare ``tool`` role is not valid for Anthropic).
    """
    system_parts: list[str] = []
    anthropic_messages: list[dict] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content", "")
        if role == "system":
            system_parts.append(_content_to_text(content))
        elif role in ("user", "assistant"):
            anthropic_messages.append(
                {"role": role, "content": _normalize_block_content(content)}
            )
        elif role == "tool":
            block = {
                "type": "tool_result",
                "tool_use_id": message.get("tool_call_id"),
                "content": message.get("content", ""),
            }
            if (
                anthropic_messages
                and anthropic_messages[-1].get("role") == "user"
                and isinstance(anthropic_messages[-1].get("content"), list)
            ):
                anthropic_messages[-1]["content"].append(block)
            else:
                anthropic_messages.append({"role": "user", "content": [block]})
    return system_parts, anthropic_messages


def _content_to_text(content) -> str:
    """Flatten a message content into plain text (for the system prompt)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b.get("text", "")
            for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return str(content)


def _normalize_block_content(content):
    """Keep block-array content as-is; stringify plain text for Anthropic."""
    if isinstance(content, list):
        return content
    return str(content)


def _model_result_from_anthropic(data: dict) -> "ModelResult":
    content_blocks = data.get("content", [])
    content = "".join(
        block.get("text", "") for block in content_blocks if block.get("type") == "text"
    )
    stop_reason = data.get("stop_reason")
    # Some Anthropic-compatible endpoints return tool_use blocks without the
    # canonical "tool_use" stop_reason — detect tool calls from the blocks too.
    has_tool_use = any(
        b.get("type") == "tool_use" for b in content_blocks if isinstance(b, dict)
    )
    tool_calls = (
        parse_tool_calls_anthropic(content_blocks)
        if (stop_reason == "tool_use" or has_tool_use)
        else []
    )
    return ModelResult(content=content, tool_calls=tool_calls, stop_reason=stop_reason)


def _model_result_from_openai(message: dict) -> "ModelResult":
    content = message.get("content", "") or ""
    tool_calls = parse_tool_calls_openai(message)
    stop_reason = "tool_use" if tool_calls else "stop"
    return ModelResult(content=content, tool_calls=tool_calls, stop_reason=stop_reason)


@dataclass
class ModelResult:
    """Normalised model response that may carry tool calls."""

    content: str
    tool_calls: list[ToolCall]
    stop_reason: str | None = None
