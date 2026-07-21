# DEC-0005: Propose → Validate → Repair → Commit narrative pipeline

**Status:** accepted (directional)  
**Date:** 2026-07-21  
**Product:** ABQ Roleplay Lab / Breaking Bad roleplay  

## Context

Character Policy Cards (e.g. Walter) already encode mask, engine, contradiction,
failure modes, relationship tactics, and knowledge rights. The bottleneck is the
**call chain**, not the cards:

- Director emits concrete `agent_act` / `agent_think` / `agent_speak` in one shot.
- Only `agent_speak` is rewritten by Character Agents.
- Character `thinking` was previously dropped (fixed partially in Loop N+).
- World consistency and "is this worth staging" are left to the LLM.

Industrial interactive narrative (neuro-symbolic pattern) separates **creative
proposal** (LLM) from **symbolic validation and commit** (rules / state).

Related research framing: neuro-symbolic interactive storytelling — LLM proposes;
symbolic layers enforce location, inventory, knowledge, and legal transitions
(see e.g. arXiv:2606.13348 and the broader propose-verify literature).

## Decision

Adopt a **Propose → Validate → Repair → Commit** pipeline for Story mode.

### Roles

| Role | Authority | Must not |
|------|-----------|----------|
| **Director / Narrative Planner** | Beat Contract: dramatic change, constraints, present cast | Write final spoken lines or character-specific tactics |
| **Character Policy Agent** | Turn Proposal: act / inner monologue / speech act / line | Invent facts outside Continuity Board knowledge rights |
| **World Validator** | Hard legality: preconditions, knowledge, affordance | Score taste |
| **Narrative Critic** | Soft quality: voice, tension, worth staging | Mutate world state |
| **State Reducer** | Deterministic apply of accepted effects | Invent narrative |
| **Stage Compiler** (future) | Map events → stage cues / 3D / camera | Decide story truth |

### Beat Contract (Director output)

Director answers: **why this beat exists, what must change, what must not.**

```json
{
  "beat_id": "beat_04",
  "dramatic_role": "progressive",
  "location_id": "saul_office",
  "present_characters": ["walter", "saul"],
  "value_before": "Walter believes Saul can be controlled",
  "value_after": "Saul reveals he has leverage",
  "dramatic_question": "Will Walter threaten Saul or negotiate?",
  "pressure_source": "Saul knows more than Walter expected",
  "required_outcome": [
    "Walter discovers Saul has independent leverage"
  ],
  "forbidden_outcomes": [
    "Walter immediately confesses everything",
    "Saul behaves physically fearless",
    "Either character knows hidden facts unavailable to them"
  ]
}
```

Aliases in product language: Scene Objective / Dramatic Constraint /
Authorial Intent Specification.

### Turn Proposal (Character output)

Each present character returns a **strategy object**, not only a line.

Rename audience-facing inner text to **`inner_monologue`** (not model chain-of-thought).

Fields (v1):

- `actor_id`, `observed_facts`, `private_goal`, `fear`
- `relationship_tactic`, `speech_act`, `surface_intent`, `subtext`
- `action` (verb, target, preconditions, effects — structured)
- `inner_monologue`, `line`, `emotion_state`

### Correctness criteria

**Act** = goal alignment + legal preconditions + affordance + explainable effects  
  (+ character style; e.g. Walter raises precision before volume).

**Inner monologue** = only known facts; exposes goal/fear/misread; tension with
line; no plot exposition; no future knowledge; not a paraphrase of the line.

**Speak** = speech_act + surface_intent + subtext + relationship_tactic +
voice realization. The sentence is the last step, not the first.

### Pipeline (Story)

```text
World state
  → Director: Beat Contract
  → Character Agents: Turn Proposals (parallel per present cast)
  → World Validator (hard fail → repair / alternate candidate)
  → Narrative Critic (score → pick)
  → State Reducer (deterministic deltas)
  → SSE events (+ Stage Compiler cues later)
```

### SSE / UI mapping (compatibility)

| Proposal field | Current event (transitional) |
|----------------|------------------------------|
| `action` | `agent_act` |
| `inner_monologue` | `agent_think.thought_content` |
| `line` | `agent_speak.content` |
| `emotion_state` | `agent_speak.emotion_state` |

Player-facing surfaces must never show McKee craft scaffolding or validator
internals (see also scene-label sanitization).

## Non-goals (this decision)

- Full 3D stage runtime
- Multi-candidate beam search in production v1
- Replacing McKee outline spine (DEC-0003) — contracts sit **under** outline beats
- Crew / Direct chat full pipeline rewrite (Story first)

## Phased delivery

| Phase | Ship | Success |
|-------|------|---------|
| **P0** | This ADR + Pydantic contracts + CONTEXT glossary | Types importable; tests round-trip JSON ✅ |
| **P1** | Director emits Beat Contract; Characters emit Turn Proposal for speak/think | Story still SSE-compatible; think from character policy ✅ (envelope + synthesize + Turn Proposal commit) |
| **P2** | World Validator (knowledge + forbidden_outcomes) | Violations repaired or blocked with actionable error |
| **P3** | Narrative Critic scoring + optional second candidate | Measurable drop in "generic" act/think |
| **P4** | State Reducer sole writer of Continuity Board deltas | No free-text world mutation from LLM |
| **P5** | Stage Compiler cues | Optional; not required for 2D UI |

## Consequences

- Positive: persona authority, world consistency, evaluable gates, clear seams for agents.
- Cost: more LLM calls per beat; latency and quota pressure.
- Mitigation: cache contracts; validate symbolically before re-call; BYOK path for power users.

## References

- Internal: DEC-0003 (McKee), Character templates under `materials/breaking-bad/`
- Research framing: neuro-symbolic interactive narrative (e.g. arXiv:2606.13348)
