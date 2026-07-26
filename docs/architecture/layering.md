# Layering: `backend/agents/` vs `backend/scenes/`

> **Status:** accepted (Loop 13)
> **Source decisions:** DEC-0005 (Propose → Validate → Repair → Commit),
> DEC-0003 (McKee Story engine), Loop 12 P4 sole-writer invariant.
> **Owners:** `backend/agents/` = LLM-facing proposal/emitter code.
> `backend/scenes/` = deterministic correctness, validation, scoring,
> and state-reduction code.

This document is the load-bearing architectural rule for the Story-mode
pipeline. It exists so a future contributor can answer the question
"where does this code belong?" without re-litigating DEC-0005.

---

## 1. The two layers

### 1.1 `backend/agents/` — LLM emitters (non-deterministic)

These modules call external model providers, parse JSON output, and
produce **untrusted proposals** that flow into the validator.

| Module | Role |
|--------|------|
| `agents/director.py` | Emits the **Beat Contract** for a beat (`value_before`, `value_after`, `dramatic_question`, `pressure_source`, `required_outcome`, `forbidden_outcomes`). |
| `agents/narrative_contracts.py` | Pydantic models for `BeatContract`, `TurnProposal`, `ActionProposal`, `ValidationIssue`, `CriticScore`. The **schema boundary** between LLM creativity and committed story state. |
| `agents/character_intelligence.py` + `agents/characters/*` | Emit the **Turn Proposal** (act, inner_monologue, speech_act, surface_intent, subtext, line) per character. |
| `agents/mckee_story.py` | Higher-level beat planning / spine shape. |
| `agents/memory.py` | Continuity advisory memory; writes are advisory-only (see §3). |
| `agents/continuity_board.py` | Pydantic models + read access for the Continuity Board. **Never writes** — see §3. |
| `agents/plot_graph.py` | Story spine graph (advisory). |

These modules may be **non-deterministic** (LLM calls), but they must be
**schema-strict**: a malformed output that fails Pydantic validation is
an emitter bug, never an evaluator bug.

### 1.2 `backend/scenes/` — correctness (deterministic)

These modules are **deterministic** Python — no LLM calls, no model
providers, no network IO. They assert legality, score quality, and apply
effects to the Continuity Board.

| Module | Role |
|--------|------|
| `scenes/world_mode.py` | Canon / Alternate / Sandbox mode selection + parsing. |
| `scenes/action_ontology.py` | Closed verb vocabulary + mapping; rejects unknown actions. |
| `scenes/validator.py` | Hard rules: knowledge boundary, actor presence, irreversible costs, preconditions. The only authority that may reject a turn. |
| `scenes/critic.py` | Soft quality: intentionality, causal relevance, continuity, dramatic value, visual executability (weights 30/25/20/15/10). Comparable, not unique. |
| `scenes/state_reducer.py` | **Sole writer** of the Continuity Board (Loop 12 P4). Applies validated effects. |
| `scenes/*` (future) | `stage_kit/` for 3D cue emission; follows the same deterministic contract. |

---

## 2. Allowed dependency direction

```
  backend/agents/  (LLM emitters)
        │
        │  produces: BeatContract, TurnProposal, ActionProposal
        ▼
  backend/scenes/  (correctness)
        │
        │  reads / writes: Continuity Board (state_reducer only)
        ▼
  backend/db/      (persistence)
```

* `backend/agents/` MAY import `backend/scenes/` for **type-only**
  references (e.g. `WorldMode`) but **must not** rely on its side effects.
  In practice, agents import the contract models in
  `agents/narrative_contracts.py` and pass them to scenes.
* `backend/scenes/` MAY import `backend/agents/` for **Pydantic models**
  declared under `agents/narrative_contracts.py` (the schema boundary).
  It must not import the LLM-calling emitters themselves.
* Neither layer may reach into `backend/db/` directly for mutations;
  the Board is mutated only by `scenes/state_reducer.py`.

**Forbidden edges:**

* `agents/*` → `scenes/state_reducer.apply_*` (the Board writer).
* `agents/*` → `scenes/validator` calls that **commit** state (validate
  freely; committing is the reducer's job).
* Any free-text LLM delta being written to `shared_facts`,
  `present_cast`, `updated_at_beat`, or `irreversible_costs`.

---

## 3. The Continuity Board writer invariant

> **The Continuity Board is mutated only by `backend/scenes/state_reducer.py`.**

This invariant was frozen by Loop 12 P4 and is enforced by a static AST
walker at `backend/tests/scenes/test_sole_writer.py`:

* Zero `apply_delta_facts` references outside `state_reducer.py`.
* Zero direct writes to `shared_facts` / `present_cast` /
  `updated_at_beat` / `irreversible_costs` outside `state_reducer.py`.

The legacy LLM-side helper `apply_delta_facts` was renamed to
`record_llm_proposed_deltas` (advisory only — returns proposed facts
for observability, never mutates the Board). The Director still emits a
`world_state_delta` SSE event for visibility, but the Board ignores it.

This separation is what allows Loop 13's value-flip gate to trust that
fixture-level `value_before` / `value_after` reflect the committed
story state, not whatever the LLM happened to hallucinate.

---

## 4. The schema boundary

`BeatContract` and `TurnProposal` are the **only** objects that cross
the agents → scenes boundary as data:

```python
# agents/narrative_contracts.py
class BeatContract(BaseModel):
    beat_id: str
    dramatic_role: DramaticRole
    location_id: str
    present_characters: list[ActorId]
    value_before: str
    value_after: str
    dramatic_question: str
    pressure_source: str
    required_outcome: list[str]
    forbidden_outcomes: list[str]
```

They are **untrusted inputs** from `scenes/`'s point of view. The
validator does not assume the BeatContract is internally consistent —
it asserts required_outcomes are achievable and forbidden_outcomes
are not present in the candidates.

If the Director fails to emit a BeatContract, `agents/narrative_contracts.synthesize_beat_contract`
produces a fallback so the pipeline never deadlocks — but the
synthesized contract is itself a deterministic artifact, not an LLM
output, and is tagged accordingly.

---

## 5. Evaluation-only metadata (Loop 13)

`backend/eval/golden_harness.py` reads **fixture-level** fields outside
the BeatContract schema:

```json
{
  "value_polarity_before": "control",
  "value_polarity_after":  "leverage",
  "value_flip_review": {
    "escape_hatch": true,
    "reviewer_note": "intentional non-flip; pressure held within control frame"
  }
}
```

These fields are **evaluation-only**. They are not part of `BeatContract`,
`TurnProposal`, or any production narrative schema. They do not enter
the McKee spine, the validator, or the reducer. They exist solely so the
golden harness can decide whether a beat meaningfully reversed its
narrative polarity.

If the McKee spine or `BeatContract` schema changes, the value-flip
gate continues to work because it reads directly off the fixture dict.

---

## 6. Concrete examples (drawn from DEC-0005)

* A Director call returns `BeatContract` → `scenes.validator.validate_world_turn`
  asserts knowledge rights → `scenes.critic.score_turn` ranks both
  candidates → `scenes.state_reducer.apply_validated_turn` commits the
  winning candidate to the Board → SSE events fan out to the Stage
  Compiler (later) and the UI.
* A Character Agent emits `TurnProposal` → same path, but the Director's
  BeatContract is the parent constraint.
* An unknown action verb in a Turn Proposal is rejected by
  `scenes/action_ontology.map_action_verb` and mapped to `idle_tense`
  (safe default). This is a scenes-layer decision, never an agents-layer
  one.
* A late-arc Walter confession on an early-era Board is *not* hard-rejected
  by the validator; `scenes/critic.py::score_intentionality` and
  `score_continuity` penalize it (`era_bleed_voice`). Soft, not hard.

---

## 7. Decision rule for new code

When adding a module, ask:

1. **Does it call an LLM provider?** → `backend/agents/`. Stop.
2. **Does it assert legality, score quality, or write to the Board?**
   → `backend/scenes/`.
3. **Does it cross both?** Split: emitters in `agents/`, evaluation in
   `scenes/`. The schema models (`narrative_contracts.py`) live with the
   emitters because the LLM produces them.
4. **Does it need to mutate `shared_facts` / `present_cast` /
   `updated_at_beat` / `irreversible_costs`?** It belongs in
   `scenes/state_reducer.py`, full stop. If you find yourself wanting to
   bypass that, the answer is "no".

When in doubt, see DEC-0005 P4 and `tests/scenes/test_sole_writer.py`.