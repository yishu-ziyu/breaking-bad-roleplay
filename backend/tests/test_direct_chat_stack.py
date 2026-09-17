"""Lean Direct stack: labeled speakers + short dossier."""

from agents.direct_chat_stack import (
    build_direct_dossier,
    build_labeled_history,
    extract_open_thread_from_durable,
)


def test_labeled_history_marks_player_only():
    hist = build_labeled_history(
        [
            {"sender": "user", "text": "昨天被人抢了"},
            {"sender": "jesse", "text": "谁干的。"},
        ],
        character_id="jesse",
        relation="partner",
        language="zh",
    )
    assert hist[0]["role"] == "user"
    assert hist[0]["content"].startswith("玩家（partner）:")
    assert hist[1]["role"] == "assistant"
    assert hist[1]["content"] == "谁干的。"


def test_strip_self_prefix():
    from agents.direct_chat_stack import strip_self_prefix

    assert strip_self_prefix("杰西: 先说清楚。", "jesse", "zh") == "先说清楚。"
    assert strip_self_prefix("Jesse: Sit down.", "jesse", "en") == "Sit down."


def test_dossier_is_short_and_not_a_rule_dump():
    dossier = build_direct_dossier(
        "jesse",
        relation="partner",
        language="zh",
        open_thread="昨天被人抢了",
    )
    assert "You are 杰西" in dossier or "杰西" in dossier
    assert "partner" in dossier
    assert "NOT you" in dossier
    assert "silent" in dossier.lower() or "This turn you want" in dossier
    assert "open thread" in dossier.lower() or "Open thread" in dossier
    # Must stay lean — no multi-page craft essay
    assert len(dossier) < 1200
    assert "Never use bullet lists" not in dossier


def test_extract_open_thread():
    blob = (
        "Relationship memory\n"
        "- [secret] foo\n"
        "- [open_thread] user: 昨天被人抢了\n"
    )
    assert "昨天被人抢了" in extract_open_thread_from_durable(blob)
