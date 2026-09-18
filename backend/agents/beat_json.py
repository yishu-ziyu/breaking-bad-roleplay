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


def _loads_lenient(candidate: str) -> object | None:
    """json.loads with a few safe repairs (trailing commas)."""
    if not candidate or not candidate.strip():
        return None
    raw = candidate.strip()
    attempts = [raw, _TRAILING_COMMA_RE.sub(r"\1", raw)]
    for a in attempts:
        try:
            return json.loads(a)
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
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


def _extract_contract_raw(payload: Any) -> dict[str, Any] | None:
    """Pull Beat Contract dict from DEC-0005 envelope if present."""
    if not isinstance(payload, dict):
        return None
    for key in ("contract", "beat_contract", "beatContract"):
        raw = payload.get(key)
        if isinstance(raw, dict) and raw:
            return raw
    return None


def _salvage_events(text: str) -> list[dict[str, Any]]:
    """Recover event objects from a structurally broken plan (2026-09-18).

    Observed MiniMax-M3 failure: an ``agent_speak`` event closes one brace
    early and leaves ``"recommended_model"`` dangling inside the events array —

        {"type":"agent_speak","data":{...,"content":"…"},
         "emotion_state":"tense","gif_search_query":"…"},
        "recommended_model":"minimax/MiniMax-M3"}

    The array is invalid JSON, but every event object still balance-scans as a
    well-formed object. Collect those objects individually instead of losing
    the whole beat to a re-parse that reproduces the same shape. Truncated
    output keeps the events that were already complete.
    """
    start = text.find('"events"')
    arr_start = text.find("[", start) if start >= 0 else text.find("[")
    if arr_start < 0:
        return []
    pos = arr_start + 1
    events: list[dict[str, Any]] = []
    while pos < len(text):
        brace = text.find("{", pos)
        if brace < 0:
            break
        close = text.find("]", pos)
        if 0 <= close < brace:
            break
        obj_text = _balanced_slice(text[brace:], "{", "}")
        if not obj_text:
            break
        payload = _loads_lenient(obj_text)
        if isinstance(payload, dict) and payload.get("type"):
            events.append(payload)
        pos = brace + len(obj_text)
    return events


def _salvage_contract(text: str) -> dict[str, Any] | None:
    """Best-effort Beat Contract from the same broken plan text."""
    start = text.find('"contract"')
    if start < 0:
        return None
    brace = text.find("{", start)
    if brace < 0:
        return None
    obj_text = _balanced_slice(text[brace:], "{", "}")
    if not obj_text:
        return None
    payload = _loads_lenient(obj_text)
    return payload if isinstance(payload, dict) and payload else None


def _iter_payload_candidates(text: str) -> list[Any]:
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

    seen: set[str] = set()
    unique: list[str] = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)

    payloads: list[Any] = []
    for cand in unique:
        payload = _loads_lenient(cand)
        if payload is not None:
            payloads.append(payload)
    return payloads


def parse_model_object(text: str | None) -> dict[str, Any] | None:
    """First JSON object a model stuffed in fences, braces, or prose."""
    for payload in _iter_payload_candidates(text or ""):
        if isinstance(payload, dict):
            return payload
    return None


def parse_beat_plan(text: str | None) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Extract (events, contract_raw) from LLM beat planning output.

    Supports legacy JSON arrays and DEC-0005 envelopes:
    ``{ "contract": {...}, "events": [...] }``.
    """
    if not text:
        return [], None

    best_events: list[dict[str, Any]] = []
    best_contract: dict[str, Any] | None = None

    for payload in _iter_payload_candidates(text):
        contract_raw = _extract_contract_raw(payload)
        events = _coerce_event_list(payload)
        if contract_raw and not best_contract:
            best_contract = contract_raw
        if events and (not best_events or (contract_raw and not best_events)):
            # Prefer payloads that carry both contract + events.
            if contract_raw and events:
                return events, contract_raw
            if not best_events:
                best_events = events
        elif contract_raw and not best_events:
            # Contract-only object — keep looking for events in other slices.
            best_contract = best_contract or contract_raw

    if best_events:
        return best_events, best_contract

    cleaned = _strip_noise(text or "")
    salvaged = _salvage_events(cleaned)
    if salvaged:
        logger.warning(
            "beat_json: recovered %d event(s) from malformed plan (len=%d)",
            len(salvaged),
            len(cleaned),
        )
        return salvaged, best_contract or _salvage_contract(cleaned)

    logger.warning(
        "beat_json: parse failed len=%d balanced_obj=%s balanced_arr=%s preview=%r tail=%r",
        len(cleaned),
        _balanced_slice(cleaned, "{", "}") is not None,
        _balanced_slice(cleaned, "[", "]") is not None,
        cleaned[:400].replace("\n", "\\n"),
        cleaned[-200:].replace("\n", "\\n"),
    )
    return [], best_contract


def parse_beat_events(text: str | None) -> list[dict[str, Any]]:
    """Extract beat event objects from an LLM response (legacy entrypoint)."""
    events, _contract = parse_beat_plan(text)
    return events


def parse_preview(text: str | None, *, limit: int = 240) -> str:
    """Safe short preview for error payloads (no secrets expected)."""
    if not text:
        return ""
    t = _strip_noise(text).replace("\n", " ")
    if len(t) <= limit:
        return t
    return t[: limit - 1] + "…"
