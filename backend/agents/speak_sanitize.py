"""Sanitize agent_speak dialogue: pure spoken line, no meta stage notes.

Product rule (taste):
- agent_speak.content = only words the character says / could say aloud
- Physical action belongs in agent_act, not inside parentheses in dialogue
- Meta narration in parentheses is forbidden
  (e.g. "像是老师对学生讲清重点", "as if teaching a class")
"""

from __future__ import annotations

import re

_OPEN = "（(【["
_CLOSE = {
    "）": "（",
    ")": "(",
    "】": "【",
    "]": "[",
}

# Even after paren strip, models sometimes leave bare meta clauses.
_META_PHRASE_RE = re.compile(
    r"(?:"
    r"像是[^。！？\n]{0,24}|"
    r"仿佛[^。！？\n]{0,24}|"
    r"好似[^。！？\n]{0,24}|"
    r"带着[^。！？\n]{0,16}的(?:神情|语气|口吻|目光)|"
    r"as if [^.!?\n]{0,40}|"
    r"like a teacher[^.!?\n]{0,40}|"
    r"in a tone that[^.!?\n]{0,40}"
    r")",
    re.IGNORECASE,
)

_MULTI_SPACE_RE = re.compile(r"[ \t]{2,}")
_MULTI_NL_RE = re.compile(r"\n{3,}")
# Em/en dash leftovers around stripped parens
_ORPHAN_DASH_RE = re.compile(r"[ \t]*[—–-]{1,2}[ \t]*(?=[，。！？,.!?]|$)|(?<=[，。！？,.!?])[ \t]*[—–-]{1,2}[ \t]*")


def strip_parentheticals(text: str) -> str:
    """Remove all script-style parentheticals from dialogue (handles nesting)."""
    if not text:
        return ""
    out: list[str] = []
    stack: list[str] = []  # expected open chars for each open frame
    depth = 0
    for ch in text:
        if ch in _OPEN:
            stack.append(ch)
            depth += 1
            continue
        if ch in _CLOSE:
            expected_open = _CLOSE[ch]
            if depth > 0 and stack and stack[-1] == expected_open:
                stack.pop()
                depth -= 1
                continue
            if depth > 0:
                # Mismatched closer inside a paren — still drop it
                continue
            # Orphan closer outside paren — drop (cleanup)
            continue
        if depth == 0:
            out.append(ch)
    return "".join(out)


def sanitize_speak_content(text: str | None) -> str:
    """Return player-facing spoken dialogue only.

    Idempotent. Empty input → empty string.
    """
    if not text:
        return ""
    out = str(text)
    out = strip_parentheticals(out)
    out = _META_PHRASE_RE.sub("", out)
    out = _ORPHAN_DASH_RE.sub(" ", out)
    out = _MULTI_SPACE_RE.sub(" ", out)
    out = _MULTI_NL_RE.sub("\n\n", out)
    # Collapse spaces before Chinese punctuation
    out = re.sub(r" +([，。！？、；：])", r"\1", out)
    out = re.sub(r"([，。！？、；：]){2,}", r"\1", out)
    return out.strip()


def is_meta_parenthetical(body: str) -> bool:
    """True if a parenthetical body is narrator commentary, not performable action."""
    b = (body or "").strip()
    if not b:
        return False
    meta_markers = (
        "像是", "仿佛", "好似", "似乎", "带着", "透着",
        "as if", "like a", "as though", "in a tone",
        "神情", "口吻", "语气中", "讲解", "讲清重点",
        "对学生", "读者", "观众",
    )
    lower = b.lower()
    if any(m in b or m in lower for m in meta_markers):
        return True
    # Long "literary" stage notes are almost always author voice
    if len(b) > 16 and any(c in b for c in "的地得"):
        return True
    return False
