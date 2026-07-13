"""Generic BYOK OpenAI-compatible route uses bind override base_url + key."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("STEPFUN_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")

from agents.credential_context import CredentialOverride, use_credentials
from agents.provider import ProviderFacade


def _make_provider() -> ProviderFacade:
    from config import settings

    settings.minimax_api_key = "fake-minimax-key"
    settings.stepfun_api_key = "fake-stepfun-key"
    return ProviderFacade(settings)


@pytest.mark.asyncio
async def test_byok_openai_compatible_uses_override_base_and_key():
    provider = _make_provider()
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": "yo from deepseek"}}]
    }
    provider._client.post = AsyncMock(return_value=mock_resp)

    ov = CredentialOverride(
        provider_id="deepseek",
        model_id="deepseek-chat",
        llm_key="sk-user-deepseek",
        base_url="https://api.deepseek.com",
    )
    with use_credentials(ov):
        text = await provider.call_model(
            [{"role": "user", "content": "hi"}],
            "deepseek/deepseek-chat",
        )

    assert text == "yo from deepseek"
    args, kwargs = provider._client.post.call_args
    assert args[0] == "https://api.deepseek.com/chat/completions"
    assert kwargs["headers"]["Authorization"] == "Bearer sk-user-deepseek"
    assert kwargs["json"]["model"] == "deepseek-chat"


@pytest.mark.asyncio
async def test_byok_uses_preset_default_base_when_override_missing_base():
    provider = _make_provider()
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": "ok"}}]
    }
    provider._client.post = AsyncMock(return_value=mock_resp)

    ov = CredentialOverride(
        provider_id="openai",
        model_id="gpt-4o-mini",
        llm_key="sk-openai",
        base_url=None,
    )
    with use_credentials(ov):
        text = await provider.call_model(
            [{"role": "user", "content": "hi"}],
            "openai/gpt-4o-mini",
        )

    assert text == "ok"
    args, _kwargs = provider._client.post.call_args
    assert args[0] == "https://api.openai.com/v1/chat/completions"
