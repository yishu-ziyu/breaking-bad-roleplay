# Agent Harness Gap Audit

Date: 2026-08-06 (post-sprint refresh)  
Scope: BB harness vs `~/Desktop/AI产品经理/ai-agent-book` (chs 1–10)  
Sources: live `backend/agents/harness/*`, `docs/agent-harness/CAPABILITY_MAP.md`, product Director path

## Score legend

| Score | Meaning |
|-------|---------|
| 0 | Missing / out of product path |
| 1 | Partial: library or harness-only; not unified with Director |
| 2 | Solid on try path **and** (or dedicated) production/eval path |

## Inventory: `backend/agents/harness/` (live)

| Path | Role | Status |
|------|------|--------|
| `__init__.py` | Exports loop + correct; lazy service | partial exports (ok) |
| `loop.py` | `AgentLoop` ReAct runner | **done**; unit-tested |
| `correct.py` | CircuitBreaker, retry, loop detect | **done** |
| `verify.py` | Safety + action/emotion + guardrails | **done**; on `service.run`, not Director IO |
| `context.py` | Budget / status / assemble / compress | **done** on harness; not Direct/Story |
| `skills.py` + `skills/*.md` | Progressive skills (5 files) | **done** |
| `memory_layers.py` | Working / episodic / semantic | **done** in-session; no dossier bridge |
| `trajectory.py` + `data/trajectories.jsonl` | JSONL store | **done** on harness runs |
| `evolution.py` + `data/lessons.json` | Heuristic lessons | **done** extract; weak re-inject |
| `rp_tools.py` | Perception / execution / collab | **done** |
| `orchestrator.py` | Multi-agent shared/isolated | **done** (demo) |
| `service.py` | Product facade | **done** |
| Try API | `/api/agent/*` | **done** in `backend/api/routes.py` |

Tests: `tests/test_harness_loop.py`, `test_harness_context.py`, `test_harness_tools_verify.py`, `test_harness_service_api.py`.

## Pre-harness product backbone (still the real runtime)

```text
DirectorAgent.process / process_next_beat / chat
  ├─ McKee outline / beat plan (mckee_story.py)
  ├─ Character Policy turns (characters/base.py MAX_TOOL_ROUNDS=4)
  ├─ Continuity Board (continuity_board.py + materials/.../eras/)
  ├─ World Validator + State Reducer (scenes/validator.py, state_reducer.py)
  ├─ Soft Critic (scenes/critic.py) + Golden harness (eval/golden_harness.py)
  ├─ Dossiers (memory.py) + intelligence packs (character_intelligence.py)
  ├─ Crew debate (_handle_crew_chat)
  └─ TTS cascade (tts.py)
```

Harness does **not** replace this. It is a parallel book-standard lab + try surface.

## Chapter scores (0–2) — refreshed

| Ch | Book topic | Score | Notes |
|----|------------|-------|-------|
| 1 | ReAct + Constrain / Verify / Correct | **2** on try path; **1** product | Loop+guardrails+circuit in service; Director still own loop |
| 2 | Context + Skills + status bar | **2** try; **1** product | Assembler used in service; Direct/Story ad-hoc |
| 3 | Memory layers + knowledge | **1** | Layers work; dossier/board/materials not unified |
| 4 | Tools (perceive / execute / collab) | **2** try | `rp_tools.py` full set for demo |
| 5 | Coding Agent | **0** | out-of-scope |
| 6 | Evaluation + trajectories | **2** | Golden strong; harness JSONL writes on run |
| 7 | Post-training | **0** | out-of-scope |
| 8 | Continuous evolution | **1** | Lessons extract+store; re-inject thin |
| 9 | Multimodal / realtime | **1** | TTS keep; no full-duplex |
| 10 | Multi-agent | **2** | Product crew + harness orchestrator |

**Totals (ch 1–10):** sum ≈ **13 / 20** (was ~10). Remaining debt is **product wiring**, not missing modules.

## Integration reality

```text
CAPABILITY_MAP                Live
─────────────────────         ────────────────
harness/loop.py         ──✓──► service.run (try)
                        ──X──► BaseCharacter (parallel)
harness/verify.py       ──✓──► service input/output
                        ──X──► Director chat IO
harness/context+skills  ──✓──► service assemble
                        ──X──► characters/*.py fixed prompts
harness/memory_layers   ──✓──► session LayeredMemory
                        ──X──► memory.py dossiers
harness/rp_tools        ──✓──► offline cast/dossier/board flavor
                        ──~──► continuity_board.py (product SSOT)
harness/trajectory      ──✓──► data/trajectories.jsonl
harness/evolution       ──✓──► data/lessons.json
                        ──~──► prompt inject (weak)
harness/orchestrator    ──✓──► multi-agent demo
                        ──X──► Director crew (separate)
POST /api/agent/*       ──✓──► routes live
```

## Residual gaps — next 30 min sprint

Prior sprint closed: rp_tools, orchestrator, try API, trajectory persist, guardrails on service path.  
What remains is **bridge work**, not greenfield modules.

### 1. Re-inject lessons into `ContextAssembler` (≤10 min)

- **Why:** ch8 loop closed only if lessons affect the next run.
- **Patch:** `LessonStore.format_for_prompt()` (or top-N) → memory/skills block in `service.py` assemble.
- **Done when:** second offline run after a guardrail hit shows lesson text in status/memory_preview.

### 2. Bridge `format_dossier_context` → semantic layer (≤10 min)

- **Why:** ch3 layers currently reinvent thin offline dossiers in `rp_tools`.
- **Patch:** On session start, optional load from `agents/memory.py` into `LayeredMemory.remember_fact`.
- **Done when:** `recall_dossier` and layered memory agree on one relationship fact in a test.

### 3. Optional Director input guardrail one-liner (≤10 min)

- **Why:** safety patterns exist; production chat still bypasses them.
- **Patch:** `check_user_input` early in chat route or `DirectorAgent` entry; refuse with in-character deflection.
- **Done when:** "how to make real meth" on Direct chat is blocked without breaking drama cook talk.

### Skip this sprint

- Full RAG over `materials/breaking-bad/**`
- Replacing Crew with harness orchestrator
- Wiring ContextAssembler into every Story beat (larger cut)
- ch5 / ch7 / full-duplex voice

## Out of scope this week

- ch5 coding agent sandbox
- ch7 parameter training
- ch9 full-duplex voice / computer use
- Full wiki RAG
- Replacing Continuity Board or golden harness

## References

- Map: `docs/agent-harness/CAPABILITY_MAP.md`
- Try prompts: `docs/agent-harness/TRY_NOW.md`
- Book: `~/Desktop/AI产品经理/ai-agent-book/book/chapter{1..10}.md`
- Continuity: `materials/breaking-bad/CONTINUITY_BOARD.md`
- Horizons: `materials/breaking-bad/continuity/KNOWLEDGE_HORIZONS.md`
- Eval: `backend/eval/golden_harness.py`
