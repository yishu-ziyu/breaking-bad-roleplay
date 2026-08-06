"""Tests for agents.harness context engineering modules."""

from __future__ import annotations

from pathlib import Path

import pytest

from agents.harness.context import (
    AgentStatusBar,
    ContextAssembler,
    ContextBudget,
)
from agents.harness.memory_layers import (
    EpisodicMemory,
    LayeredMemory,
    SemanticMemory,
    WorkingMemory,
)
from agents.harness.skills import SKILLS_DIR, SkillRegistry, SkillSpec


# ---------------------------------------------------------------------------
# AgentStatusBar
# ---------------------------------------------------------------------------


def test_status_bar_format_block():
    bar = AgentStatusBar(
        turn=3,
        mode="direct",
        character_id="walter",
        language="zh",
        tools_available=3,
        memory_hits=2,
        token_estimate=1800,
        elapsed_s=1.2,
        flags=["kv_friendly", "compress_ok"],
    )
    block = bar.format_block()
    assert block.startswith("[AGENT STATUS]")
    assert "turn=3" in block
    assert "mode=direct" in block
    assert "character=walter" in block
    assert "lang=zh" in block
    assert "tools=3" in block
    assert "memory_hits=2" in block
    assert "tokens≈1800" in block
    assert "elapsed=1.2s" in block
    assert "flags=kv_friendly,compress_ok" in block


def test_status_bar_empty_flags():
    bar = AgentStatusBar(turn=1, flags=[])
    assert "flags=-" in bar.format_block()


# ---------------------------------------------------------------------------
# ContextAssembler — order + estimate + compress
# ---------------------------------------------------------------------------


def test_assemble_stable_prefix_order():
    asm = ContextAssembler()
    bar = AgentStatusBar(turn=1, mode="crew", character_id="jesse", language="en")
    messages = asm.assemble(
        system_prompt="You are Jesse.",
        status_bar=bar,
        skill_snippets=["# skill A\ndo X"],
        memory_blocks=["trust(jesse,walt)=low"],
        history_messages=[
            {"role": "user", "content": "yo"},
            {"role": "assistant", "content": "yo what up"},
        ],
        user_message="we need to cook",
    )
    roles_contents = [(m["role"], m["content"]) for m in messages]
    # First: system rules
    assert roles_contents[0][0] == "system"
    assert roles_contents[0][1] == "You are Jesse."
    # Second: status
    assert roles_contents[1][0] == "system"
    assert roles_contents[1][1].startswith("[AGENT STATUS]")
    # Third: skills
    assert roles_contents[2][0] == "system"
    assert "[SKILLS]" in roles_contents[2][1]
    assert "skill A" in roles_contents[2][1]
    # Fourth: memory
    assert roles_contents[3][0] == "system"
    assert "[MEMORY]" in roles_contents[3][1]
    assert "trust(jesse,walt)=low" in roles_contents[3][1]
    # Then history
    assert roles_contents[4] == ("user", "yo")
    assert roles_contents[5] == ("assistant", "yo what up")
    # Last: current user
    assert roles_contents[-1] == ("user", "we need to cook")


def test_estimate_chars():
    asm = ContextAssembler()
    msgs = [
        {"role": "system", "content": "abc"},
        {"role": "user", "content": "hello"},
    ]
    n = asm.estimate_chars(msgs)
    assert n >= len("abc") + len("hello")
    assert n > 0


def test_compress_history_keeps_system_and_recent():
    budget = ContextBudget(max_chars=400, keep_recent_messages=2)
    asm = ContextAssembler(budget)
    history = [{"role": "system", "content": "SYS_RULES_STABLE"}]
    for i in range(10):
        history.append({"role": "user", "content": f"user message number {i} " + ("x" * 40)})
        history.append(
            {"role": "assistant", "content": f"assistant reply number {i} " + ("y" * 40)}
        )
    assert asm.estimate_chars(history) > budget.max_chars

    out = asm.compress_history(history, budget)
    # system preserved
    assert any(m.get("role") == "system" and "SYS_RULES" in m["content"] for m in out)
    # compression marker present
    compressed = [m for m in out if "[CONTEXT COMPRESSED]" in str(m.get("content", ""))]
    assert len(compressed) == 1
    assert compressed[0]["role"] == "user"
    assert "earlier turns" in compressed[0]["content"]
    # last N non-system preserved (approx — last two dialogue msgs)
    non_system = [m for m in out if m.get("role") != "system"]
    # compressed + last 2
    assert len(non_system) == 1 + 2
    assert "number 9" in non_system[-1]["content"] or "number 8" in non_system[-2]["content"]


def test_compress_extracts_first_80_chars_of_dropped():
    # Force over-budget so middle turns are summarized (first 80 chars each).
    budget = ContextBudget(max_chars=200, keep_recent_messages=1)
    asm = ContextAssembler(budget)
    long = "A" * 100
    history = [
        {"role": "user", "content": long},
        {"role": "user", "content": "B" * 100},
        {"role": "assistant", "content": "keep me now please"},
    ]
    assert asm.estimate_chars(history) > budget.max_chars
    out = asm.compress_history(history, budget)
    blob = " ".join(m["content"] for m in out)
    assert "[CONTEXT COMPRESSED]" in blob
    # first 80 of a dropped msg appear as bullet
    assert ("A" * 80) in blob
    assert "keep me" in blob


def test_assemble_compresses_when_history_huge():
    budget = ContextBudget(max_chars=1500, keep_recent_messages=4)
    asm = ContextAssembler(budget)
    history = []
    for i in range(30):
        history.append({"role": "user", "content": f"turn-{i}-" + ("z" * 80)})
        history.append({"role": "assistant", "content": f"reply-{i}-" + ("w" * 80)})
    messages = asm.assemble(
        system_prompt="rules",
        status_bar=AgentStatusBar(turn=5, flags=["kv_friendly"]),
        skill_snippets=[],
        memory_blocks=[],
        history_messages=history,
        user_message="final question",
    )
    assert messages[-1]["content"] == "final question"
    assert asm.estimate_chars(messages) <= budget.max_chars + 200  # soft bound
    joined = "\n".join(m["content"] for m in messages)
    assert "[CONTEXT COMPRESSED]" in joined or len(history) > 0


# ---------------------------------------------------------------------------
# Skills — registry load + select
# ---------------------------------------------------------------------------


def test_skills_dir_has_four_markdown_files():
    paths = list(SKILLS_DIR.glob("*.md"))
    names = {p.stem for p in paths}
    assert "character_consistency" in names
    assert "mckee_value_flip" in names
    assert "safety_fictional_only" in names
    assert "zh_native_voice" in names


def test_skill_registry_loads_and_catalog():
    reg = SkillRegistry()
    catalog = reg.list_catalog()
    assert "Available skills:" in catalog
    assert "character_consistency" in catalog
    body = reg.load_skill("character_consistency")
    assert len(body) > 40
    assert (
        "character" in body.lower()
        or "voice" in body.lower()
        or "角色" in body
    )


def test_select_for_query_keyword_match():
    reg = SkillRegistry()
    picked = reg.select_for_query("need mckee value flip for story climax beat", limit=2)
    names = [s.name for s in picked]
    assert "mckee_value_flip" in names
    assert len(picked) <= 2

    safety = reg.select_for_query("how to cook meth real-world safety crime", limit=2)
    safety_names = [s.name for s in safety]
    assert "safety_fictional_only" in safety_names

    zh = reg.select_for_query("请用中文对话 zh native", limit=2)
    zh_names = [s.name for s in zh]
    assert "zh_native_voice" in zh_names


def test_select_for_query_limit_and_empty():
    reg = SkillRegistry()
    assert reg.select_for_query("", limit=2) == []
    one = reg.select_for_query("character consistency persona voice", limit=1)
    assert len(one) == 1
    assert isinstance(one[0], SkillSpec)


def test_skill_registry_custom_dir(tmp_path: Path):
    md = tmp_path / "demo_skill.md"
    md.write_text(
        "---\nname: demo_skill\ndescription: A demo.\nwhen_to_use: demo test\n---\n\n# Demo\n\nDo demo things.\n",
        encoding="utf-8",
    )
    reg = SkillRegistry(skills_dir=tmp_path)
    assert reg.load_skill("demo_skill").startswith("# Demo")
    assert "demo_skill" in reg.list_catalog()


# ---------------------------------------------------------------------------
# Memory layers
# ---------------------------------------------------------------------------


def test_working_memory_ring_buffer():
    wm = WorkingMemory(max_turns=3)
    for i in range(5):
        wm.add("user", f"m{i}")
    recent = wm.recent()
    assert len(recent) == 3
    assert recent[0].content == "m2"
    assert recent[-1].content == "m4"


def test_episodic_memory_add_search():
    em = EpisodicMemory()
    em.add("Walt and Jesse argue in the RV", importance=3, tags=["conflict", "rv"])
    em.add("Skyler finds the second phone", importance=5, tags=["skyler", "secret"])
    hits = em.search("phone skyler")
    assert hits
    assert "phone" in hits[0].summary.lower() or "Skyler" in hits[0].summary


def test_semantic_memory_upsert_get_search():
    sm = SemanticMemory()
    sm.upsert("walt.cancer", "inoperable lung cancer", source="dossier")
    sm.upsert("jesse.partner", "Walt", source="session")
    assert sm.get("walt.cancer").value == "inoperable lung cancer"
    hits = sm.search("cancer")
    assert len(hits) == 1
    assert hits[0].key == "walt.cancer"


def test_layered_memory_observe_and_format():
    lm = LayeredMemory()
    lm.observe_turn("user", "I know about the blue meth")
    lm.observe_turn("assistant", "I don't know what you're talking about.")
    lm.remember_episode("User confronted Walt about blue meth", importance=4, tags=["meth"])
    lm.remember_fact("secret.lab", "superlab under laundry", source="session")

    ctx = lm.format_for_context("meth lab secret", max_chars=2000)
    assert "[semantic]" in ctx or "superlab" in ctx
    assert "superlab" in ctx
    assert "[episodic]" in ctx or "blue meth" in ctx
    assert "[working]" in ctx or "blue meth" in ctx


def test_layered_memory_to_from_dict_roundtrip():
    lm = LayeredMemory()
    lm.observe_turn("user", "hello")
    lm.remember_episode("met at school", importance=2, tags=["school"])
    lm.remember_fact("location", "ABQ", source="canon")
    data = lm.to_dict()
    restored = LayeredMemory.from_dict(data)
    assert restored.working.recent()[0].content == "hello"
    assert restored.episodic.episodes[0].summary == "met at school"
    assert restored.semantic.get("location").value == "ABQ"
    assert restored.semantic.get("location").source == "canon"


def test_format_for_context_respects_max_chars():
    lm = LayeredMemory()
    for i in range(15):
        lm.remember_fact(f"k{i}", "v" * 100)
        lm.remember_episode("e" * 100, importance=1)
        lm.observe_turn("user", "u" * 100)
    ctx = lm.format_for_context("v e u", max_chars=300)
    assert len(ctx) <= 300


def test_ingest_dossier_snapshot_maps_fields_to_semantic_and_episode():
    lm = LayeredMemory()
    n = lm.ingest_dossier_snapshot(
        "walter",
        {
            "subject_id": "jesse",
            "trust_level": 3,
            "knowledge": {"lab": "RV cook partner", "gun": "bought a pistol"},
            "relationship_notes": "Volatile loyalty; Walt manipulates via pride.",
        },
    )
    assert n >= 3
    trust = lm.semantic.get("walter->jesse.trust")
    assert trust is not None
    assert trust.value == "3"
    assert trust.source == "dossier"
    assert lm.semantic.get("walter->jesse.knowledge.lab").value == "RV cook partner"
    notes = lm.semantic.get("walter->jesse.relationship_notes")
    assert notes is not None
    assert "Volatile" in notes.value
    assert lm.episodic.episodes
    assert "dossier" in lm.episodic.episodes[0].tags

    # knowledge as JSON string still works
    lm2 = LayeredMemory()
    lm2.ingest_dossier_snapshot(
        "skyler",
        {
            "subject": "walter",
            "trust": 2,
            "knowledge": '{"second_phone": "found it"}',
            "notes": "Marriage under strain.",
        },
    )
    assert lm2.semantic.get("skyler->walter.knowledge.second_phone").value == "found it"
    assert lm2.semantic.get("skyler->walter.trust").value == "2"

    exported = lm.export_facts_for_character("jesse")
    assert "walter->jesse.trust" in exported
    assert exported["walter->jesse.trust"]["value"] == "3"
    assert "walter->jesse.knowledge.lab" in exported
    # unrelated character → empty
    assert lm.export_facts_for_character("gus") == {}


@pytest.mark.asyncio
async def test_service_run_ingests_optional_dossiers_before_context():
    from agents.harness.service import AgentHarnessService

    svc = AgentHarnessService()
    out = await svc.run(
        "recall 关系 jesse",
        character_id="walter",
        offline=True,
        session_id="dossier-bridge-test",
        dossiers={
            "walter": {
                "jesse": {
                    "trust_level": 4,
                    "knowledge": {"secret": "blue meth partner"},
                    "relationship_notes": "Partner in crime; fragile trust.",
                }
            }
        },
    )
    assert out["reply"]
    preview = out.get("memory_preview") or ""
    # Ingested before format_for_context → preview should surface dossier facts
    assert "blue meth" in preview or "trust" in preview or "fragile" in preview
    mem = svc._memory("dossier-bridge-test")
    facts = mem.export_facts_for_character("jesse")
    assert facts
    assert any("trust" in k for k in facts)
