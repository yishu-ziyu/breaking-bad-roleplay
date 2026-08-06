"""Tests for LiteLLM integration with ProviderFacade.

These tests verify the use_litellm flag wiring and fallback behavior.
They do NOT call any real LLM API — all external calls are mocked.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.provider import ProviderFacade


def _make_provider(use_litellm: bool = False) -> ProviderFacade:
    """Build a ProviderFacade with stub settings."""
    settings = MagicMock()
    settings.minimax_api_key = "fake-minimax-key"
    settings.stepfun_api_key = "fake-stepfun-key"
    settings.cli_proxy_base_url = "http://localhost:8080"
    settings.cli_proxy_api_key = "fake-cli-proxy-key"
    settings.cli_proxy_default_model = "claude-3-sonnet"
    return ProviderFacade(settings=settings, use_litellm=use_litellm)


class TestLiteLLMProviderFacadeIntegration:
    """Scenario: ProviderFacade with use_litellm=True must wire up correctly
    and fall back to the direct provider when LiteLLM fails."""

    def test_provider_facade_use_litellm_flag(self):
        """Given use_litellm=True, the ProviderFacade initializes without
        error and the flag is set."""
        provider = _make_provider(use_litellm=True)
        assert provider.use_litellm is True

    def test_provider_facade_use_litellm_false(self):
        """Given use_litellm=False (default), the ProviderFacade behaves
        exactly as before — no LiteLLM code path is activated."""
        provider = _make_provider(use_litellm=False)
        assert provider.use_litellm is False

    def test_provider_facade_default_use_litellm_is_false(self):
        """Given no use_litellm argument, the default is False."""
        settings = MagicMock()
        provider = ProviderFacade(settings=settings)
        assert provider.use_litellm is False

    @patch("agents.provider.ProviderFacade._call_litellm")
    async def test_use_litellm_true_routes_through_litellm(self, mock_call_litellm):
        """Given use_litellm=True, call_model tries LiteLLM first."""
        mock_call_litellm.return_value = "litellm response"
        provider = _make_provider(use_litellm=True)
        provider._client.post = AsyncMock()  # prevent real HTTP calls

        result = await provider.call_model(
            messages=[{"role": "user", "content": "hi"}],
            model_route="stepfun/step-3.7-flash",
        )

        assert result == "litellm response"
        mock_call_litellm.assert_awaited_once_with(
            [{"role": "user", "content": "hi"}],
            "stepfun/step-3.7-flash",
            4096,
        )

    @patch("agents.provider.ProviderFacade._call_litellm",
           side_effect=RuntimeError("LiteLLM failed"))
    async def test_litellm_call_model_fallback(self, mock_call_litellm):
        """Given use_litellm=True but LiteLLM raises, call_model falls back
        to the direct provider."""
        provider = _make_provider(use_litellm=True)
        provider._client.post = AsyncMock(
            return_value=MagicMock(
                raise_for_status=MagicMock(return_value=None),
                json=MagicMock(
                    return_value={"choices": [{"message": {"content": "fallback ok"}}]}
                ),
            )
        )

        result = await provider.call_model(
            messages=[{"role": "user", "content": "hi"}],
            model_route="stepfun/step-3.7-flash",
        )

        assert result == "fallback ok"
        mock_call_litellm.assert_awaited_once()

    @patch("agents.provider.ProviderFacade._call_litellm",
           side_effect=RuntimeError("LiteLLM failed"))
    async def test_litellm_fallback_preserves_stepfun_to_minimax_fallback(
        self, mock_call_litellm
    ):
        """Given use_litellm=True and both LiteLLM and StepFun fail, the
        StepFun→MiniMax fallback still works (the existing chain is preserved)."""
        provider = _make_provider(use_litellm=True)
        # StepFun raises HTTP 402
        import httpx
        request = httpx.Request("POST", "https://api.stepfun.com/v1/chat/completions")
        response = httpx.Response(402, request=request)
        provider._call_stepfun = AsyncMock(
            side_effect=httpx.HTTPStatusError("quota", request=request, response=response)
        )
        provider._call_minimax = AsyncMock(return_value="minimax fallback")

        result = await provider.call_model(
            messages=[{"role": "user", "content": "hi"}],
            model_route="stepfun/step-2-16k",
        )

        assert result == "minimax fallback"
        provider._call_minimax.assert_awaited_once()

    def test_litellm_patch_does_not_break_existing(self):
        """Given use_litellm=False, the patch is not applied and existing
        behavior is unchanged."""
        import agents.litellm_patch as lp
        lp._PATCHED = False

        provider = _make_provider(use_litellm=False)
        assert provider.use_litellm is False
        assert lp._PATCHED is False  # patch was NOT applied

    @patch("agents.provider.logger")
    @patch("agents.litellm_patch.patch_litellm")
    def test_init_with_litellm_true_applies_patches(self, mock_patch, mock_logger):
        """Given use_litellm=True, patch_litellm() is called during init."""
        import agents.provider as provider_mod
        # Re-import to trigger the fresh init
        settings = MagicMock()
        _ = ProviderFacade(settings=settings, use_litellm=True)
        mock_patch.assert_called_once()