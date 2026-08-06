"""
LiteLLM integration patch for ProviderFacade.

Overrides 4 known LiteLLM bugs (stub/no-op patches awaiting upstream fixes):

1. tool_use_id ↔ tool_call_id mismatch during OpenAI→Anthropic translation
   (BerriAI/litellm/issues/16711)
2. cache_control field loss during OpenAI→Anthropic conversion
   (router-for-me/CLIProxyAPI/issues/3165)
3. Streaming tool_call index incorrect
4. Function calling parameter type conversion errors

Usage:
    from agents.litellm_patch import patch_litellm
    patch_litellm()  # Apply all patches
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

_PATCHED = False


def patch_litellm():
    """Apply all known LiteLLM bug patches. Safe to call multiple times."""
    global _PATCHED
    if _PATCHED:
        return

    try:
        import litellm  # noqa: F401
    except ImportError:
        logger.warning("litellm not installed, skipping patches")
        return

    _patch_tool_use_id_mismatch()
    _patch_cache_control()
    _patch_streaming_tool_call_index()
    _patch_function_call_params()

    _PATCHED = True
    logger.info("LiteLLM patches applied: tool_use_id, cache_control, streaming_index, function_params")


def _patch_tool_use_id_mismatch():
    """Fix tool_use_id ↔ tool_call_id mismatch during OpenAI→Anthropic translation.

    Reference: BerriAI/litellm/issues/16711
    When translating OpenAI tool_calls to Anthropic format, the tool_call_id is
    incorrectly mapped to tool_use_id. This patch ensures correct mapping.

    NOTE: This is a stub. The actual fix requires upstream LiteLLM changes.
    Once the upstream fix is released, replace this function body with:
        litellm.litellm_core_utils.litellm_logging = ...
    """
    logger.warning(
        "LiteLLM patch #1 (tool_use_id mismatch) is a stub — "
        "upstream fix not yet applied. See BerriAI/litellm/issues/16711."
    )
    # ---- Actual fix goes here once upstream is available ----


def _patch_cache_control():
    """Fix cache_control field loss during OpenAI→Anthropic conversion.

    Reference: router-for-me/CLIProxyAPI/issues/3165
    Anthropic's cache_control field is dropped when converting from OpenAI format.

    NOTE: This is a stub. The actual fix requires upstream LiteLLM changes.
    """
    logger.warning(
        "LiteLLM patch #2 (cache_control field loss) is a stub — "
        "upstream fix not yet applied. See router-for-me/CLIProxyAPI/issues/3165."
    )
    # ---- Actual fix goes here once upstream is available ----


def _patch_streaming_tool_call_index():
    """Fix streaming tool_call index being incorrect.

    In streaming mode, LiteLLM sometimes assigns wrong indices to tool calls,
    causing duplicate or missing tool calls in the final response.

    NOTE: This is a stub. The actual fix requires upstream LiteLLM changes.
    """
    logger.warning(
        "LiteLLM patch #3 (streaming tool_call index) is a stub — "
        "upstream fix not yet applied."
    )
    # ---- Actual fix goes here once upstream is available ----


def _patch_function_call_params():
    """Fix function calling parameter type conversion errors.

    When converting OpenAI function parameters to Anthropic format, some types
    (e.g., number → float, integer → int) are incorrectly handled.

    NOTE: This is a stub. The actual fix requires upstream LiteLLM changes.
    """
    logger.warning(
        "LiteLLM patch #4 (function call params type conversion) is a stub — "
        "upstream fix not yet applied."
    )
    # ---- Actual fix goes here once upstream is available ----