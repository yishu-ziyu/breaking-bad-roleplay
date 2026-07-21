"""agent_speak content must be pure dialogue — no meta parentheticals."""

from __future__ import annotations

from agents.speak_sanitize import (
    is_meta_parenthetical,
    sanitize_speak_content,
    strip_parentheticals,
)


def test_strips_meta_teacher_parenthetical():
    raw = (
        "杰克……你刚才说的话，我可以当成生意上的试探。"
        "但你得明白一件事——（声音放低，像是老师对学生讲清重点）"
        "我能让你舅舅的农场变成一个永远不会有人来查的安静地方。"
    )
    clean = sanitize_speak_content(raw)
    assert "像是老师" not in clean
    assert "讲清重点" not in clean
    assert "（" not in clean and "）" not in clean
    assert "杰克" in clean
    assert "安静地方" in clean


def test_strips_halfwidth_and_english_meta():
    raw = 'I can end this. (voice lowers, as if teaching a class) Choose.'
    clean = sanitize_speak_content(raw)
    assert "(" not in clean and ")" not in clean
    assert "as if" not in clean.lower()
    assert "I can end this" in clean
    assert "Choose" in clean


def test_strips_performable_parens_from_speak_too():
    # Product choice: ALL parentheticals leave speak; actions use agent_act.
    raw = "（脚步停住）你现在开枪，等于亲手毁掉自己唯一的保命符。"
    clean = sanitize_speak_content(raw)
    assert "脚步" not in clean
    assert "保命符" in clean
    assert clean.startswith("你")


def test_idempotent_and_empty():
    assert sanitize_speak_content("") == ""
    assert sanitize_speak_content(None) == ""
    once = sanitize_speak_content("（停顿）走。")
    assert sanitize_speak_content(once) == once


def test_is_meta_parenthetical_detects_commentary():
    assert is_meta_parenthetical("声音放低，像是老师对学生讲清重点")
    assert is_meta_parenthetical("as if lecturing a student")
    assert not is_meta_parenthetical("放低声音")
    assert not is_meta_parenthetical("停住脚步")


def test_strip_parentheticals_nested_pass():
    raw = "A（外层（内））B"
    # Our regex is non-nested-aware; multi-pass should still clear opens.
    out = strip_parentheticals(raw)
    assert "（" not in out and "）" not in out
