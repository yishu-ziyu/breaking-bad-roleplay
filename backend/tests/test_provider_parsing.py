"""Cycle 27: L6 — harden provider response parsing.

_call_stepfun and _call_minimax previously used direct dict/list access
(data["choices"][0]["message"]["content"]) which raised generic KeyError /
IndexError on malformed API responses (error bodies, empty choices). These
generic exceptions were caught by the director's `except Exception` handler
and logged as "Beat LLM call failed" — losing the actual API error message.

These tests verify that malformed responses now raise RuntimeError with a
descriptive message that includes the API error context.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.provider import ProviderFacade


def _make_provider() -> ProviderFacade:
    """Build a ProviderFacade with stub settings. The real httpx client is
    replaced by tests via ``provider._client`` before any call is made."""
    settings = MagicMock()
    settings.minimax_api_key = "fake-minimax-key"
    settings.stepfun_api_key = "fake-stepfun-key"
    return ProviderFacade(settings=settings)


def _mock_response(payload: dict):
    """Build a mock httpx.Response: raise_for_status is a no-op, json()
    returns the given payload."""
    resp = MagicMock()
    resp.raise_for_status = MagicMock(return_value=None)
    resp.json = MagicMock(return_value=payload)
    return resp


class TestCycle27_ProviderResponseParsing:
    """Scenario: malformed API responses (error bodies, empty choices,
    empty content) must raise RuntimeError with a descriptive message
    instead of a generic KeyError/IndexError that hides the actual API
    error."""

    async def test_stepfun_malformed_error_response_raises_runtime_error(self):
        """Given StepFun returns an error body {"error": {"message": ...}},
        RuntimeError is raised with 'StepFun API error: <message>'."""
        provider = _make_provider()
        provider._client.post = AsyncMock(
            return_value=_mock_response(
                {"error": {"message": "rate limited"}}
            )
        )
        with pytest.raises(RuntimeError) as exc_info:
            await provider._call_stepfun(
                messages=[{"role": "user", "content": "hi"}],
                model="step-3.7-flash",
            )
        assert "StepFun API error: rate limited" in str(exc_info.value)

    async def test_stepfun_empty_choices_raises_runtime_error(self):
        """Given StepFun returns {"choices": []}, RuntimeError mentions
        'no choices' so the operator knows the API returned nothing."""
        provider = _make_provider()
        provider._client.post = AsyncMock(
            return_value=_mock_response({"choices": []})
        )
        with pytest.raises(RuntimeError) as exc_info:
            await provider._call_stepfun(
                messages=[{"role": "user", "content": "hi"}],
                model="step-3.7-flash",
            )
        assert "no choices" in str(exc_info.value)

    async def test_stepfun_empty_content_raises_runtime_error(self):
        """Given StepFun returns a choice with empty content, RuntimeError
        mentions 'empty content' instead of silently returning ''."""
        provider = _make_provider()
        provider._client.post = AsyncMock(
            return_value=_mock_response(
                {"choices": [{"message": {"content": ""}}]}
            )
        )
        with pytest.raises(RuntimeError) as exc_info:
            await provider._call_stepfun(
                messages=[{"role": "user", "content": "hi"}],
                model="step-3.7-flash",
            )
        assert "empty content" in str(exc_info.value)

    async def test_stepfun_valid_response_returns_content(self):
        """Given a well-formed StepFun response, the content string is
        returned unchanged (no false-positive RuntimeError)."""
        provider = _make_provider()
        provider._client.post = AsyncMock(
            return_value=_mock_response(
                {"choices": [{"message": {"content": "Hello from StepFun"}}]}
            )
        )
        result = await provider._call_stepfun(
            messages=[{"role": "user", "content": "hi"}],
            model="step-3.7-flash",
        )
        assert result == "Hello from StepFun"

    async def test_minimax_malformed_error_response_raises_runtime_error(self):
        """Given MiniMax returns an error body {"error": {"message": ...}},
        RuntimeError is raised with 'MiniMax API error: <message>'."""
        provider = _make_provider()
        provider._client.post = AsyncMock(
            return_value=_mock_response(
                {"error": {"message": "invalid api key"}}
            )
        )
        with pytest.raises(RuntimeError) as exc_info:
            await provider._call_minimax(
                messages=[{"role": "user", "content": "hi"}],
                model="MiniMax-M1",
                max_tokens=128,
            )
        assert "MiniMax API error: invalid api key" in str(exc_info.value)
