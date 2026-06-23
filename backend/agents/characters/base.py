from abc import ABC, abstractmethod
import json
import re
from typing import Sequence

from agents.provider import ProviderFacade

# Prompt appended when structured output is requested so the LLM returns
# a JSON envelope alongside the in-character reply.
STRUCTURED_OUTPUT_PROMPT = """\

Respond ONLY with a single JSON object (no markdown fences, no extra text):

{
  "reply_text": "<the character's in-character reply>",
  "emotion_state": "<one of: calm, tense, angry, fearful, manipulative, guilty, resigned, desperate>",
  "gif_search_query": "<English visual emotion search phrase, e.g. 'walter white angry determined'>",
  "thinking": "<brief inner monologue or reasoning (1-3 sentences)>",
  "tool_executed": "<tool name if a tool was called, otherwise null>",
  "tool_log": "<tool execution result or null>"
}

RULES:
- reply_text must be the character's spoken reply only (no narration).
- emotion_state must be exactly one of: calm, tense, angry, fearful, manipulative, guilty, resigned, desperate.
- gif_search_query must be in English and descriptive enough for image search.
- thinking reveals what the character is really thinking beneath their words.
- tool_executed and tool_log describe any fictional in-world tool the character used (e.g. "disposal service", "lab inventory check"), or null if none.
- Do NOT include any fields outside this schema.
"""


def _extract_structured(text: str) -> dict:
    """
    Try to parse a character response that may contain a JSON envelope.

    Returns a dict with keys: reply_text, emotion_state, gif_search_query,
    thinking, tool_executed, tool_log.  Falls back to plain-text reply if
    no JSON is found.
    """
    # Strip markdown fences if present
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    raw = fenced.group(1) if fenced else text.strip()

    # Find the outer JSON object
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            return {
                "reply_text": data.get("reply_text", text),
                "emotion_state": data.get("emotion_state"),
                "gif_search_query": data.get("gif_search_query"),
                "thinking": data.get("thinking"),
                "tool_executed": data.get("tool_executed"),
                "tool_log": data.get("tool_log"),
            }
        except (json.JSONDecodeError, TypeError):
            pass

    # No JSON found — return the raw text as the reply
    return {
        "reply_text": text,
        "emotion_state": None,
        "gif_search_query": None,
        "thinking": None,
        "tool_executed": None,
        "tool_log": None,
    }


class BaseCharacter(ABC):
    """
    Abstract base for all roleplay character agents.

    Each concrete character supplies its own system prompt and
    optional personality tweaks via `respond()`.
    """

    def __init__(self, name: str, provider: ProviderFacade):
        self.name = name
        self.provider = provider

    @abstractmethod
    def system_prompt(self) -> str:
        """Return the character's system prompt."""

    @abstractmethod
    async def respond(
        self,
        context: Sequence[dict],
        user_message: str,
        model_route: str = "stepfun/step-3.7-flash",
    ) -> str:
        """
        Generate an in-character reply.

        Args:
            context: Ordered list of prior messages (role + content).
            user_message: The latest user utterance the character reacts to.
            model_route: Provider/model selector passed to ProviderFacade.

        Returns:
            The character's reply text.
        """

    async def respond_structured(
        self,
        context: Sequence[dict],
        user_message: str,
        model_route: str = "stepfun/step-3.7-flash",
    ) -> dict:
        """
        Generate an in-character reply with structured metadata.

        Appends a JSON-output instruction to the system prompt and parses
        the LLM response into a dict with keys:
          reply_text, emotion_state, gif_search_query, thinking,
          tool_executed, tool_log

        Falls back gracefully if the model does not return valid JSON.
        """
        # Build messages with structured-output instruction
        messages: list[dict] = [
            {"role": "system", "content": self.system_prompt() + STRUCTURED_OUTPUT_PROMPT},
        ]
        messages.extend(context)
        messages.append({"role": "user", "content": user_message})

        try:
            raw = await self.provider.call_model(messages, model_route)
        except Exception:
            raw = json.dumps({
                "reply_text": "...",
                "emotion_state": "calm",
                "gif_search_query": None,
                "thinking": None,
                "tool_executed": None,
                "tool_log": None,
            })

        return _extract_structured(raw)
