"""Personal plot graph: session-unique story net after play."""

from __future__ import annotations

from types import SimpleNamespace

from agents.continuity_board import new_session_board
from agents.plot_graph import (
    build_plot_graph,
    characters_from_messages,
    co_presence_edges,
    parse_outline_beats,
    to_mermaid,
)


def test_parse_outline_beats_numbered():
    outline = "1. Superlab - pressure\n2. Office - Gus waits\n3. Desert - decision"
    beats = parse_outline_beats(outline)
    assert len(beats) == 3
    assert beats[0]["id"] == "beat_0"
    assert "Superlab" in beats[0]["label"]


def test_parse_outline_beats_strips_mckee_meta():
    """McKee spine headers must not become plot-graph beat nodes."""
    outline = """
PROTAGONIST: Hank Schrader
SPINE: uncover the truth without destroying his family
VALUE_PAIR: loyalty / betrayal
CONSCIOUS_DESIRE: catch the cook
# BEATS
1. [setup] Schrader backyard — value: safety→unease
2. [inciting] DEA office — value: order→imbalance
3. [climax] Desert road — value: facade→break
"""
    beats = parse_outline_beats(outline)
    assert len(beats) == 3
    labels = " ".join(b["label"] for b in beats)
    assert "PROTAGONIST" not in labels
    assert "SPINE" not in labels
    assert "VALUE_PAIR" not in labels
    assert "CONSCIOUS" not in labels
    assert "backyard" in beats[0]["label"]

    meta_only = "PROTAGONIST: Hank\nSPINE: dig\nVALUE_PAIR: a / b"
    assert parse_outline_beats(meta_only) == []


def test_co_presence_links_speakers_in_same_beat():
    msgs = [
        SimpleNamespace(character_name="Walter White", beat_id="b1"),
        SimpleNamespace(character_name="Jesse Pinkman", beat_id="b1"),
        SimpleNamespace(character_name="Saul Goodman", beat_id="b2"),
    ]
    edges = co_presence_edges(msgs)
    pairs = {(e["source"], e["target"]) for e in edges}
    # Node ids are normalized short ids: char_walter / char_jesse
    assert ("char_walter", "char_jesse") in pairs or ("char_jesse", "char_walter") in pairs
    assert len(edges) >= 1


def test_build_plot_graph_personal_and_dual_layer():
    board = new_session_board(session_id="sess-pg", era="s3_mid")
    msgs = [
        SimpleNamespace(
            character_name="Walter White",
            beat_id="0",
            content="We stay precise.",
        ),
        SimpleNamespace(
            character_name="Jesse Pinkman",
            beat_id="0",
            content="Yeah, what about me?",
        ),
    ]
    graph = build_plot_graph(
        session_id="sess-pg",
        title="My cook night",
        task_prompt="Argue about the next cook",
        outline="1. Lab argument\n2. Roof silence",
        messages=msgs,
        board=board,
    )
    assert graph["session_id"] == "sess-pg"
    kinds = {n["kind"] for n in graph["nodes"]}
    assert "beat" in kinds
    assert "character" in kinds
    assert "fact" in kinds
    edge_kinds = {e["kind"] for e in graph["edges"]}
    assert "spine" in edge_kinds
    assert "co_presence" in edge_kinds or "tension" in edge_kinds
    # personal: uses this session task, not generic series dump
    assert "Argue about the next cook" in graph["task_prompt"]
    assert graph["summary"]["beat_count"] == 2
    assert "flowchart" in graph["mermaid"]


def test_mermaid_export_nonempty():
    nodes = [
        {"id": "beat_0", "kind": "beat", "label": "Lab"},
        {"id": "char_walter", "kind": "character", "label": "Walter"},
    ]
    edges = [
        {
            "id": "e1",
            "source": "beat_0",
            "target": "char_walter",
            "kind": "knows",
            "label": "in",
        }
    ]
    text = to_mermaid(nodes, edges)
    assert "flowchart" in text
    assert "Walter" in text


def test_characters_from_messages_counts_speaks():
    msgs = [
        {"character_name": "Jesse Pinkman"},
        {"character_name": "Jesse Pinkman"},
        {"character_name": "Walter White"},
    ]
    chars = characters_from_messages(msgs)
    jesse = next(c for c in chars if "Jesse" in c["label"])
    assert jesse["speak_count"] == 2


def test_build_plot_graph_zh_uses_text_zh_and_cast_names():
    board = new_session_board(session_id="sess-zh", era="s3_mid")
    msgs = [
        SimpleNamespace(character_name="Walter White", beat_id="0", content="x"),
        SimpleNamespace(character_name="Jesse Pinkman", beat_id="0", content="y"),
    ]
    graph = build_plot_graph(
        session_id="sess-zh",
        title="t",
        task_prompt="任务",
        outline="1. 实验室争执\n2. 屋顶沉默",
        messages=msgs,
        board=board,
        language="zh",
    )
    facts = [n for n in graph["nodes"] if n["kind"] == "fact"]
    assert facts, "expected fact nodes"
    assert any("古斯" in f["label"] or "合伙" in f["label"] or "制毒" in f["label"] for f in facts), facts[:2]
    # no long English seed leakage on first facts when zh available
    assert not any(f["label"].startswith("The cook partnership") for f in facts)
    chars = [n for n in graph["nodes"] if n["kind"] == "character"]
    labels = {c["label"] for c in chars}
    assert "沃尔特" in labels
    assert "杰西" in labels
    tens = [e for e in graph["edges"] if e["kind"] == "tension"]
    assert tens
    assert any("半吊子" in (e.get("label") or "") or "忠诚" in (e.get("label") or "") for e in tens), tens[:2]
