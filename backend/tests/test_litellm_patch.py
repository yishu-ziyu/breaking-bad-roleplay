"""Tests for LiteLLM patch module (stub/no-op patches).

These tests verify the patch infrastructure itself — they do NOT require
litellm to be installed or call any real LLM API.
"""

from __future__ import annotations

import logging
from unittest.mock import patch, MagicMock

import pytest

from agents.litellm_patch import (
    patch_litellm,
    _patch_tool_use_id_mismatch,
    _patch_cache_control,
    _patch_streaming_tool_call_index,
    _patch_function_call_params,
    _PATCHED,
)


class TestLiteLLMPatch:
    """Scenario: patch_litellm() must be safe to call multiple times, and must
    not raise when litellm is absent."""

    def setup_method(self):
        # Reset global state between tests
        import agents.litellm_patch as lp
        lp._PATCHED = False

    def test_patch_litellm_called_twice(self):
        """Given patch_litellm() is called twice, the second call is a no-op
        and does not raise."""
        patch_litellm()  # First call — no litellm installed, skips silently
        patch_litellm()  # Second call — must not raise

    def test_patch_litellm_without_litellm(self):
        """Given litellm is not installed, patch_litellm() logs a warning
        and does not raise."""
        patch_litellm()  # No litellm installed — should log warning, not raise
        # No assertion needed — the test passes if no exception is raised

    @patch("agents.litellm_patch._patch_tool_use_id_mismatch")
    @patch("agents.litellm_patch._patch_cache_control")
    @patch("agents.litellm_patch._patch_streaming_tool_call_index")
    @patch("agents.litellm_patch._patch_function_call_params")
    @patch("agents.litellm_patch._PATCHED", False)
    @patch("agents.litellm_patch.logger")
    def test_patch_litellm_with_litellm_installed(
        self, mock_logger, mock_fn4, mock_fn3, mock_fn2, mock_fn1
    ):
        """Given litellm IS importable, all four patch functions are called
        and _PATCHED is set to True."""
        with patch.dict("sys.modules", {"litellm": MagicMock()}):
            import agents.litellm_patch as lp
            lp._PATCHED = False
            lp.patch_litellm()
            assert lp._PATCHED is True
        mock_fn1.assert_called_once()
        mock_fn2.assert_called_once()
        mock_fn3.assert_called_once()
        mock_fn4.assert_called_once()

    def test_individual_patches_are_stubs(self, caplog):
        """Each individual patch function logs a warning and does not raise."""
        caplog.set_level(logging.WARNING)

        _patch_tool_use_id_mismatch()
        assert any("tool_use_id mismatch" in msg for msg in caplog.messages)

        caplog.clear()
        _patch_cache_control()
        assert any("cache_control field loss" in msg for msg in caplog.messages)

        caplog.clear()
        _patch_streaming_tool_call_index()
        assert any("streaming tool_call index" in msg for msg in caplog.messages)

        caplog.clear()
        _patch_function_call_params()
        assert any("function call params" in msg for msg in caplog.messages)

    @patch("agents.litellm_patch.logger")
    def test_patch_litellm_skips_when_already_patched(self, mock_logger):
        """Given _PATCHED is already True, patch_litellm() returns immediately."""
        import agents.litellm_patch as lp
        lp._PATCHED = True
        lp.patch_litellm()
        # No info or warning should be logged (the function returns early)
        # The only call would be from the _PATCHED check, which logs nothing
        assert mock_logger.info.call_count == 0
        assert mock_logger.warning.call_count == 0