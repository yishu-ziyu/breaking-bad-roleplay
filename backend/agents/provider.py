import httpx
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from config import settings
from agents.tools import (
    Tool,
    ToolCall,
    translate_tools_to_anthropic,
    translate_tools_to_openai,
    parse_tool_calls_anthropic,
    parse_tool_calls_openai,
)


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
        # trust_env=False disables env-level proxies (e.g. Clash socks5h) which
        # httpx cannot parse. The cli-proxy is reached via explicit base_url.
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0),
            trust_env=False,
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

        system_parts, anthropic_messages = _split_anthropic_messages(messages)

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
                if not self.minimax_key:
                    raise
                return await self._call_minimax_with_tools(messages, "MiniMax-M3", tools, max_tokens)
        if provider == "cliproxy":
            return await self._call_cli_proxy_with_tools(messages, model, tools, max_tokens)
        raise ValueError(f"Unknown provider '{provider}'. Use 'minimax', 'stepfun', or 'cliproxy'.")

    async def _call_minimax_with_tools(
        self, messages: list[dict], model: str, tools: list[Tool], max_tokens: int
    ) -> "ModelResult":
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
        resp = await self._client.post(
            "https://api.stepfun.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self.stepfun_key}",
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
        if not self.cli_proxy_key:
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
