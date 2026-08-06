# Agent Harness Capability Map (ai-agent-book → ABQ)

Source: `~/Desktop/AI产品经理/ai-agent-book`  
Formula: **Agent = Model + Harness**, Harness = Context + Tools + Constrain + Verify + Correct

Inventory date: 2026-08-06  
Ground truth: files under `backend/agents/harness/` + routes in `backend/api/routes.py`.

## Status legend

| Status | Meaning |
|--------|---------|
| **done** | Module exists, unit-covered or exercised via `service.py` / try API |
| **partial** | Module exists but not fully bridged to product Director / dossier / golden path |
| **integrate** | Product code already owns the capability; harness should wrap, not fork |
| **out-of-scope** | Not a ship goal for ABQ roleplay this cycle |

## Book → module map

| Book ch | Capability | Module | Status |
|--------|------------|--------|--------|
| 1 | ReAct loop + max_iterations | `harness/loop.py` | **done** |
| 1 | Constrain / Verify / Correct | `harness/verify.py`, `correct.py` | **done** (wired in `service.py`; not yet on Director chat IO) |
| 1 | Circuit breaker | `harness/correct.py` | **done** |
| 2 | Context assembly (5 parts) | `harness/context.py` | **done** (harness path); **partial** on Direct/Story |
| 2 | Agent status bar | `harness/context.py` | **done** |
| 2 | Context compression | `harness/context.py` | **done** |
| 2 | Progressive Skills | `harness/skills.py` + `skills/*.md` | **done** (5 skills on disk) |
| 3 | Working / episodic / semantic memory | `harness/memory_layers.py` | **done** (in-session layers) |
| 3 | Dossier integration (existing) | wraps `agents/memory.py` | **partial** (rp offline dossiers; no live dossier bridge) |
| 3 | Continuity / knowledge horizon | `skills/materials_continuity.md` + `materials/breaking-bad/` | **partial** (skill + materials exist; not auto-loaded into Director) |
| 4 | Perception / Execution / Collaboration tools | `harness/rp_tools.py` | **done** |
| 4 | Tool registry (existing) | wraps `agents/tools.py` | **integrate** |
| 5 | Coding Agent | — | **out-of-scope** |
| 6 | Trajectory logging + eval hooks | `harness/trajectory.py` + `data/trajectories.jsonl` | **done** on harness runs |
| 6 | Golden / critic (existing) | `eval/`, `scenes/critic.py` | **integrate** |
| 7 | Post-training (SFT/RL) | — | **out-of-scope** |
| 8 | Lessons from trajectories | `harness/evolution.py` + `data/lessons.json` | **done** (heuristic extract); **partial** prompt re-inject |
| 9 | TTS cascade (existing) | `agents/tts.py` | **integrate** / keep |
| 9 | Full-duplex ASR / computer-use | — | **out-of-scope** |
| 10 | Multi-agent orchestrator | `harness/orchestrator.py` | **done** (harness demo) |
| 10 | Crew debate (existing) | `director._handle_crew_chat` | **integrate** |
| product | One-shot run facade | `harness/service.py` | **done** |
| product | Try API | `GET/POST /api/agent/*` | **done** |

## On-disk inventory (harness package)

| Path | Role | Status |
|------|------|--------|
| `loop.py` | `AgentLoop` ReAct runner | done |
| `correct.py` | CircuitBreaker, retry, loop detect | done |
| `verify.py` | Safety + action/emotion + `run_guardrails` | done |
| `context.py` | Budget, status bar, assembler, compress | done |
| `skills.py` | `SkillRegistry` progressive load | done |
| `skills/*.md` | 5 progressive skills | done |
| `memory_layers.py` | Working / episodic / semantic | done |
| `rp_tools.py` | list_cast, recall_dossier, continuity, actions… | done |
| `trajectory.py` | JSONL `TrajectoryStore` | done |
| `evolution.py` | `LessonStore` + heuristic extract | done |
| `orchestrator.py` | shared / isolated multi-agent | done |
| `service.py` | Full pipeline facade | done |
| `data/trajectories.jsonl` | Run evidence | done (writes on run) |
| `data/lessons.json` | Distilled lessons | done (writes on extract) |

## Try surface

| Method | Path | Role |
|--------|------|------|
| GET | `/api/agent/capabilities` | Book coverage + module list |
| POST | `/api/agent/run` | Full harness pipeline (`offline=true` recommended) |
| GET | `/api/agent/trajectories` | Recent trajectories |
| GET | `/api/agent/lessons` | Lessons from trajectories |

See [TRY_NOW.md](./TRY_NOW.md) for copy-paste prompts.

## Integration reality (map ≠ territory)

```text
Harness try path (service.py)     Live production
─────────────────────────────     ────────────────
loop + verify + trajectory  ✓     BaseCharacter tool loop (parallel)
context + skills            ✓     ad-hoc director inject (partial)
memory_layers               ✓     memory.py dossiers (not shared)
rp_tools                    ✓     agents/tools.py + continuity_board
orchestrator                ✓     DirectorAgent + crew
POST /api/agent/*           ✓     story/chat routes (separate)
                                  eval/golden_harness (real beat Verify)
```

## Residual (next sprint)

See [GAP_AUDIT.md](./GAP_AUDIT.md) — wire lessons into assembler, bridge dossier/board, optional Director guardrail hook. Do not replace Continuity Board or golden harness.
