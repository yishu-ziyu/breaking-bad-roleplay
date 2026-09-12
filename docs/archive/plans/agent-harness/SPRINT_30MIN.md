# 30-minute Agent Harness Sprint Report

**When:** 2026-08-06  
**Source guide:** `~/Desktop/AI产品经理/ai-agent-book`  
**Target product:** Breaking Bad Roleplay (`breaking-bad-roleplay`)

## Goal

In 30 minutes of continuous orchestration + implementation + verification, approach the book's production Agent formula:

```text
Agent = Model + Harness
Harness = Context + Tools + Constrain + Verify + Correct
(+ trajectory eval, evolution lessons, multi-agent)
```

## Delivered (tryable now)

### Code

| Area | Path |
|------|------|
| ReAct loop | `backend/agents/harness/loop.py` |
| Circuit / retry / loop-detect | `backend/agents/harness/correct.py` |
| Guardrails | `backend/agents/harness/verify.py` |
| Context assemble + compress + status bar | `backend/agents/harness/context.py` |
| Skills progressive disclosure | `backend/agents/harness/skills.py` + `skills/*.md` (5) |
| Memory layers | `backend/agents/harness/memory_layers.py` |
| RP tools (perceive/execute/collab) | `backend/agents/harness/rp_tools.py` |
| Trajectories | `backend/agents/harness/trajectory.py` |
| Lessons evolution | `backend/agents/harness/evolution.py` |
| Multi-agent | `backend/agents/harness/orchestrator.py` |
| Facade | `backend/agents/harness/service.py` |
| API | `GET/POST /api/agent/*` |
| Chat optional | `POST /api/chat` with `useHarness: true` |
| UI | bottom-right **Agent 实验台** (`AgentHarnessPanel.tsx`) |

### Evidence

- Unit tests: **60 passed** (`tests/test_harness_*.py`)
- Live smoke on `:8001`:
  - cast list tools
  - dossier recall
  - safety guardrail refuse
  - multi-agent crew
  - McKee skill selection + director-offline value flip
  - lessons JSON + trajectories JSONL
  - `/api/chat` + `useHarness` with live-fail → offline fallback

## Book coverage (honest)

| Ch | Score | Note |
|----|-------|------|
| 1 Loop + CVC | 2 try / 1 product | solid lab; Director still parallel |
| 2 Context/Skills | 2 try / 1 product | not yet unified into character prompts |
| 3 Memory | 1 | layers work; dossier bridge in progress |
| 4 Tools | 2 try | 8 RP tools |
| 5 Coding Agent | 0 | out of scope |
| 6 Eval | 2 | golden + trajectory store |
| 7 Post-train | 0 | out of scope |
| 8 Evolution | 1 | extract+store; re-inject thin |
| 9 Multimodal | 1 | TTS kept |
| 10 Multi-agent | 2 | crew product + orchestrator lab |

## How you try (now)

1. Backend is expected on `http://127.0.0.1:8001` (restart if needed):

```bash
cd backend && uv run uvicorn main:app --reload --port 8001
```

2. Frontend: `npm run dev` → 右下角 **Agent 实验台**

3. Or open `docs/agent-harness/TRY_NOW.md` for 5 copy-paste curls.

## Not done / next sprint

1. Wire `AgentLoop` + `ContextAssembler` into `characters/base.py` (replace parallel tool loop)
2. Bridge Continuity Board + dossiers into LayeredMemory on every Story beat
3. Stronger lesson re-injection into Director prompts
4. Live model route with stable BYOK (fallback already exists)

## Process notes

- Parallel subagents used aggressively (loop/context/tools/API/frontend/docs/integration)
- Tests were the contract when subagents diverged; green suite was the merge gate
