# DEC-0005: Propose → Validate → Repair → Commit narrative pipeline

**Status:** accepted (directional)  
**Date:** 2026-07-21  
**Product:** ABQ Roleplay Lab / Breaking Bad roleplay  

## Context

What must be trained is not only **voice** (does this sound like Walter) but
**policy**: given world state, goals, knowledge, relationships, and temperament,
why this action, this inner monologue, and this line.

Character Policy Cards already encode mask, engine, contradiction, failure
modes, relationship tactics, session memory, knowledge rights, and irreversible
costs. The historical bottleneck was the **call chain**: Director emitted
act/think/speak; only speak was rewritten by Character Agents; Character
`thinking` was dropped (later bound in #54). Soft taste and hard legality were
left to the LLM.

Industrial interactive narrative (neuro-symbolic) separates creative proposal
(LLM) from symbolic validation and commit (rules / state).

## Decision

Adopt **Propose → Validate → Repair → Commit** for Story mode.

### Correctness formula (three layers + mode)

There is no single correct line. Correctness has three different natures.

**Layer 1 — Hard correctness (program can reject)**

World-state consistency, precondition/effect validation, knowledge boundary,
constraint satisfaction, simulation validity. Examples:

- Actor cannot know facts outside Continuity Board rights.
- Dead / off-stage actors cannot act.
- Items not held cannot be handed over.
- Door already closed cannot be closed again without reopen.
- Irreversible costs cannot be pretended away.
- `agent_act` targets, anchors, animations must exist (stage kit).
- World deltas must be caused by validated action or dialogue.

**Layer 2 — Soft correctness (comparable, not unique)**

Character intentionality, subtext vs plot dump, goal-driven vs author force,
value change this beat, non-repetition, player agency room, visual executability.
Narrative planning research frames two cores: causal plot advance and
character credibility / intentional readability.

**Layer 3 — Mode correctness**

| Mode | Meaning |
|------|---------|
| **Canon** | Strict show timeline, knowledge, relations |
| **Alternate** | Core character policy fixed; player may rewrite history |
| **Sandbox** | Keep voice recognizability; freer relations and plot |

Same utterance may fail Canon and pass Alternate.

**Formula**

```text
correct =
  hard constraints
  × character policy fit
  × dramatic goal advance
  × selected world mode
```

Not: correct = “sounds like Breaking Bad.”

### Roles

| Role | Authority | Must not |
|------|-----------|----------|
| **Director / Narrative Planner** | Beat Contract: dramatic change, constraints, present cast | Write final lines or character-specific tactics |
| **Character Policy Agent** | Turn Proposal: act / inner monologue / speech strategy / line | Invent facts outside knowledge rights |
| **World Validator** | Hard legality | Score taste |
| **Narrative Critic** | Soft quality | Mutate world state |
| **State Reducer** | Deterministic apply of accepted effects | Invent narrative |
| **Stage Compiler** | Map events → stage cues / 3D / camera | Decide story truth |

### Beat Contract / Turn Proposal

Director outputs **Beat Contract** (why this beat exists; required / forbidden
outcomes). Character Policy outputs **Turn Proposal** including structured
`action`, audience-facing **`inner_monologue`** (not model chain-of-thought),
speech_act / surface_intent / subtext / relationship_tactic / line.

### Pipeline

```text
World state + world mode
  → Director: Beat Contract
  → Character Agents: Turn Proposals
  → World Validator (hard fail → repair / drop / idle map)
  → Narrative Critic (soft score; later)
  → State Reducer (deterministic Continuity Board)
  → SSE events (+ Stage Compiler cues later)
```

### Act / think / speak criteria

- **Act** = goal alignment + legal preconditions + affordance + explainable
  effects (+ style; e.g. Walter raises precision before volume).
- **Inner monologue** = only known facts; goal/fear/misread; tension with line;
  no plot exposition; no future knowledge; not a paraphrase of the line.
- **Speak** = speech_act + surface_intent + subtext + relationship_tactic +
  voice realization (sentence last).

### Training ladder (do not fine-tune first)

1. **Golden set** (50–100 beats): context, contract, candidate A/B, preferred,
   hard_failures, preference_reasons (why the loser fails).
2. **Hard evaluator** (this package): schema, presence, knowledge, ontology,
   preconditions, effects, irreversible.
3. **Soft critic**: intentionality, voice, causal relevance, continuity,
   subtext, value turn, player agency, visual executability.
4. **Then** SFT / DPO / reward model on adjudicated preference data.

### Stage path (later PRs; not blocking 2D Story)

MVP stage kit: Saul office GLB, anchors, cameras, closed action vocabulary,
Scene Compiler → structured cues, React Three Fiber runtime. Unknown actions
map to `idle_tense`. Blender produces reusable Stage Kits; web runtime executes
cues. Do not auto-generate every Breaking Bad set.

### SSE mapping (transitional)

| Proposal field | Event |
|----------------|--------|
| `action` | `agent_act` |
| `inner_monologue` | `agent_think.thought_content` |
| `line` | `agent_speak.content` |
| `emotion_state` | `agent_speak.emotion_state` |

Player surfaces never show McKee craft scaffolding or validator internals.

## Non-goals (this decision)

- Full 3D production pipeline in v1 Story
- Multi-candidate beam search in production v1
- Replacing McKee outline spine (DEC-0003) — contracts sit under outline beats
- Crew / Direct full rewrite first (Story first)
- Fine-tuning before golden set + hard evaluator

## Phased delivery / PR map

| Phase / PR | Ship | Success |
|------------|------|---------|
| **P0** | ADR + Pydantic contracts + CONTEXT | Round-trip tests ✅ |
| **P1 / PR1** | Beat Contract + Turn Proposal; Character owns act + mind + line (`policy_turn`) | SSE-compatible; act upserted from policy ✅ |
| **P2 / PR2** | World Validator + action ontology + reducer-lite | Knowledge/presence/verb hard checks; safe idle map ✅ |
| **PR5 start** | Golden Beats hard harness (12 cases) | `backend/eval/golden_beats/` + `golden_harness.py` ✅ |
| **P3** | Narrative Critic + optional second candidate | Soft scores drive pick |
| **P4** | State Reducer sole Continuity writer | No free-text world mutation from LLM as truth |
| **PR3** | Blender Stage Kit (Saul office) | Anchors/cameras/animations in GLB extras |
| **PR4** | React 3D runtime | Load GLB, CueRunner, camera |
| **PR5** | Evaluation harness | 50 golden beats, hard tests, A/B report |

### MVP done when

1. Same story input yields stable Beat Contract structure.
2. Walter act/think/speak proposals come from Walter policy path (act fully owned by policy is still tightening).
3. Knowledge overreach, impossible space, state contradiction rejected programmatically.
4–8. Stage kit load, anchor moves, ordered cues, idle fallback, deterministic replay — later PRs.

## As-built notes

- `backend/agents/narrative_contracts.py` — contracts + SSE map
- `backend/scenes/` — ontology, world_mode, validator, state_reducer
- Director prefers `{contract, events}`; synthesizes contract if missing
- Character `policy_turn` structured reply → Turn Proposal (incl. action) → validate → commit
- `upsert_agent_act_from_turn` overwrites/inserts agent_act with `source=character_policy`
- Knowledge hard fail clears monologue; removed actors cannot speak
- Validated turns feed Continuity Board via reducer (alongside legacy deltas)
- Golden harness: preferred must hard-pass; losers must hit listed error codes

## Consequences

- Positive: persona authority, evaluable gates, clear seams for 3D later.
- Cost: more structure and calls per beat; latency/quota.
- Mitigation: symbolic validate before re-call; closed action vocabulary; BYOK.

## References

- DEC-0003 (McKee), Character templates under `materials/breaking-bad/`
- Continuity Board era packs: `materials/breaking-bad/continuity/eras/`
- Neuro-symbolic interactive narrative framing (e.g. arXiv:2606.13348)
