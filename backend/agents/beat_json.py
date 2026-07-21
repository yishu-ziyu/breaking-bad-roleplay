"""Industrial beat-event JSON extraction.

Models (MiniMax Anthropic / StepFun OpenAI / BYOK) routinely wrap or mangle
JSON. The director must extract a list of event dicts without hard-failing on
common, repairable shapes.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Strip model "thinking" / chain-of-thought wrappers before parse.
_THINK_RE = re.compile(
    r"<(?:think|thinking|reason|analysis)[^>]*>.*?</(?:think|thinking|reason|analysis)>\s*",
    re.DOTALL | re.IGNORECASE,
)
_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*([\s\S]*?)```")
_TRAILING_COMMA_RE = re.compile(r",\s*([}\]])")
# Zero-width / BOM that break json.loads
_INVISIBLE_RE = re.compile(r"[\ufeff\u200b\u200c\u200d\u2060]")


def _strip_noise(text: str) -> str:
    t = text or ""
    t = _INVISIBLE_RE.sub("", t)
    t = _THINK_RE.sub("", t)
    return t.strip()


def _balanced_slice(text: str, open_ch: str, close_ch: str) -> str | None:
    """Return the first fully balanced open…close slice, or None."""
    start = text.find(open_ch)
    if start < 0:
        return None
    depth = 0
    in_str = False
    escape = False
    quote = ""
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                in_str = False
            continue
        if ch in ('"', "'"):
            in_str = True
            quote = ch
            continue
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _loads_lenient(candidate: str) -> Any | None:
    """json.loads with a few safe repairs (trailing commas)."""
    if not candidate or not candidate.strip():
        return None
    raw = candidate.strip()
    attempts = [raw, _TRAILING_COMMA_RE.sub(r"\1", raw)]
    for a in attempts:
        try:
            return json.loads(a)
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return None


def _coerce_event_list(payload: Any) -> list[dict[str, Any]]:
    """Normalize various payload shapes into a list of event dicts."""
    if payload is None:
        return []
    if isinstance(payload, list):
        return [e for e in payload if isinstance(e, dict) and e.get("type")]
    if isinstance(payload, dict):
        # Wrapped: { "events": [ ... ] } or { "type": "...", "data": ... }
        for key in ("events", "beats", "items", "data"):
            inner = payload.get(key)
            if isinstance(inner, list):
                return [e for e in inner if isinstance(e, dict) and e.get("type")]
        if payload.get("type"):
            return [payload]
    return []


def parse_beat_events(text: str | None) -> list[dict[str, Any]]:
    """Extract beat event objects from an LLM response.

    Tries, in order:
    1. Markdown fenced JSON
    2. Balanced JSON array
    3. Balanced JSON object (single event or wrapper)
    4. First-to-last bracket fallback (legacy)
    """
    if not text:
        return []
    cleaned = _strip_noise(text)
    if not cleaned:
        return []

    candidates: list[str] = []

    for m in _FENCE_RE.finditer(cleaned):
        body = (m.group(1) or "").strip()
        if body:
            candidates.append(body)

    arr = _balanced_slice(cleaned, "[", "]")
    if arr:
        candidates.append(arr)

    obj = _balanced_slice(cleaned, "{", "}")
    if obj:
        candidates.append(obj)

    # Legacy: first [ to last ]
    s, e = cleaned.find("["), cleaned.rfind("]")
    if s >= 0 and e > s:
        candidates.append(cleaned[s : e + 1])
    s, e = cleaned.find("{"), cleaned.rfind("}")
    if s >= 0 and e > s:
        candidates.append(cleaned[s : e + 1])

    # De-dupe while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)

    for cand in unique:
        payload = _loads_lenient(cand)
        events = _coerce_event_list(payload)
        if events:
            return events

    logger.warning(
        "beat_json: parse failed len=%d preview=%r",
        len(cleaned),
        cleaned[:400].replace("\n", "\\n"),
    )
    return []


def parse_preview(text: str | None, *, limit: int = 240) -> str:
    """Safe short preview for error payloads (no secrets expected)."""
    if not text:
        return ""
    t = _strip_noise(text).replace("\n", " ")
    if len(t) <= limit:
        return t
    return t[: limit - 1] + "…"
