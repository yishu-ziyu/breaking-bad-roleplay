# DEC-0004: Vertical narrative Agent architecture (as-is, industry, next cut)

**Status:** accepted (architecture baseline)  
**Date:** 2026-07-15  
**Product:** Breaking Bad Roleplay / ABQ Roleplay Lab  
**Related:** [architecture.md](../architecture.md), [DEC-0002](./DEC-0002-hank-character-v1.md), [DEC-0003](./DEC-0003-mckee-story-engine-v1.md), [CONTEXT.md](../../CONTEXT.md)

## Context

The product is evolving from "chat with BB characters" toward an **Agent-driven interactive drama**.
Hank and McKee Story v2 shipped, but the stack still feels rough.
Questions to pin down:

1. Do we have an Agent architecture at all?
2. What does industry do for **vertical narrative** Agents (not general "do my email" Agents)?
3. What work is missing if we want a serious vertical narrative Agent product?
4. Which **one layer** should the next engineering cut deepen?

This ADR is the single page for those answers. It is a map, not an implement ticket list.

## Decision

1. **We do have a vertical narrative Agent architecture.** It is custom Python orchestration (Director + cast sub-agents + tools + memory + SSE HITL), not "no Agent" and not a generic LangGraph app.
2. **Product category = interactive drama / roleplay theater Agent**, not general-purpose task Agent.
3. **Next architecture cut (recommended): Plan / World / Runtime seams** - split Director responsibilities and make world-state + beat lifecycle first-class and observable. Defer McKee outline **editor UI** and generic tool-using browser Agents until those seams exist.
4. Treat McKee craft (DEC-0003) as the **story planning policy** inside the Plan layer, not as the whole Agent architecture.

## 1. Our architecture (as-is)

### 1.1 Diagram

```text
┌──────────────────────────── Browser ────────────────────────────┐
│  React: Direct chat | Crew | Story stage                          │
│  SSE consume · GIF · voice · scene · beat controls                │
└───────────────┬───────────────────────────┬───────────────────────┘
                │ HTTP /api/chat              │ SSE /api/session/*/stream
                │                             │ + action (continue/redirect/…)
┌───────────────▼───────────────────────────▼───────────────────────┐
│  FastAPI routes                                                     │
│  session create · stream · action · quota · TTS                     │
└───────────────┬─────────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────────┐
│  DirectorAgent  (single orchestration module today)                 │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐   │
│  │ Outline/Plan│  │ Beat runtime │  │ Direct / Crew chat paths  │   │
│  │ + McKee v2  │  │ events+HITL  │  │ (crew = one multi-cast    │   │
│  │ mckee_story │  │ sub-agents   │  │  LLM call, not N agents)  │   │
│  └──────┬──────┘  └──────┬───────┘  └───────────────────────────┘   │
│         │                │                                            │
│  ┌──────▼────────────────▼──────────────────────────────────────┐   │
│  │ Character sub-agents (walter…hank)                            │   │
│  │ system prompt · voice · tools · respond_structured            │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             │                                         │
│  ┌──────────────┐  ┌────────▼────────┐  ┌──────────────────────┐  │
│  │ Continuity   │  │ ProviderFacade  │  │ Dossier / plot_graph │  │
│  │ Board + eras │  │ LLM + tools     │  │ Postgres memory      │  │
│  └──────────────┘  └─────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Layers (product language)

| Layer | What it should mean | What we have today | Roughness |
|-------|---------------------|--------------------|-----------|
| **Intent** | Player goal, relation, mode, language | Task prompt, character, relation, Direct/Crew/Story | Clear enough |
| **Plan** | Story spine, beats, dramatic questions | Numbered outline + McKee meta/tags (DEC-0003) | Prompt-heavy; soft warnings only; no first-class Plan object in DB |
| **World** | Facts, who knows what, relationship values | Continuity board, dossiers, world_state_delta events | Uneven seed quality; deltas are free text; weak schema |
| **Cast** | Character minds + tools | 7 BaseCharacter agents + tools | Real; Crew path often bypasses true multi-agent |
| **Runtime** | Step loop, tool loop, stop conditions | process / process_next_beat, beat_ready HITL | All inside director.py; hard to observe/replay |
| **Experience** | Stage UI, GIF, voice, outline display | Rich frontend | McKee tags partially shown; no plan editor |
| **Ops** | Deploy, smoke, cost | VM primary + Vercel; dual-path footgun | Documented; easy to ship UI to wrong surface |

### 1.3 What is deliberately *not* our architecture

- Not a single ReAct "assistant with tools" for open-ended office tasks.
- Not AutoGen/CrewAI-style free multi-agent debate as the core product.
- Not full film pre-viz (40-60 scene treatments).

## 2. Industry reference (vertical narrative / interactive story Agents)

Research synthesis (public patterns + academic/product lines; not a claim we must clone any one stack):

### 2.1 Common pattern: hierarchy

Successful interactive drama systems usually separate:

1. **Drama / plot manager** - goals, beats, constraints, failure recovery  
2. **Character agents** - dialogue and local goals under the manager  
3. **World / belief state** - who knows what; inventory; relationship meters  
4. **Player interface** - choices, free text, or hybrid  
5. **Experience layer** - text, voice, image, stage  

This maps almost 1:1 to theater: director, actors, stage bible, audience, production.

Examples of the *shape* (not endorsements of specific vendors):

- Academic **interactive drama** (drama managers + character agents; beat/quest structures).  
- Game narrative: quest graphs + dialogue trees + affinity systems (state-first, LLM optional).  
- LLM multi-agent story papers: planner LLM + speaker LLMs + critic/consistency pass.  
- Industrial multi-agent frameworks (LangGraph, AutoGen, OpenAI Agents SDK): good for **graphs, tools, retries**; they do **not** ship McKee or BB cast for free - you still write the drama domain.

### 2.2 What serious vertical narrative systems invest in

| Work package | Why it matters | Our gap |
|--------------|----------------|---------|
| **Explicit plan schema** | Beats are data, not only prose lines | Outline is mostly text; McKee fields parsed ad hoc |
| **World schema** | Consistency > prettier prose | Free-text deltas; limited typed fields |
| **Belief / knowledge rights** | Prevent omniscient Hank / Walt | Continuity board exists; enforcement uneven |
| **True multi-cast turns** | Distinct minds under pressure | Crew is often one LLM roleplaying several people |
| **Critic / continuity pass** | Catch broken causal spine | Soft McKee warnings only; no hard gate by default |
| **HITL contract** | Player agency without killing drama | beat_ready actions exist; UX for plan edit weak |
| **Replay + traces** | Debug "why this beat?" | Logs exist; no first-class trace UI |
| **Eval suite** | Character voice, spoilers, safety, value turns | Partial unit tests; little story quality eval |
| **Cost / latency budget** | Story beats are multi-call | Provider routes OK; no beat cost dashboard |
| **Experience binding** | GIF/voice must match speaker | GIF pools audited for Hank; still tag-fragile |

### 2.3 Comparison table

| Dimension | General task Agent (industry default) | Vertical narrative Agent (our category) | Us today |
|-----------|----------------------------------------|-------------------------------------------|----------|
| Goal | Finish a job (book, code, research) | Sustain dramatic pressure and character truth | Drama-first |
| Planning | Tool plans / TODOs | Spine, beats, value turns, opposition | McKee-ish outline |
| State | Files, tickets, browser | World facts, relationships, knowledge rights | Board + dossiers |
| Multi-agent | Optional specialists | Cast is the product | Yes, but Crew shortcut |
| HITL | Approve tool calls | Approve plot moves | Beat pause |
| Success metric | Task done | Session feels like BB; continuity holds | Mostly vibes + unit tests |
| Framework | LangGraph etc. optional | Domain modules mandatory | Custom modules |

**Conclusion from research:**  
For vertical narrative, **domain architecture beats framework choice**.  
Roughness is expected if Plan/World/Runtime are still "prompts + one big Director file."

## 3. What work is needed (if we take vertical narrative seriously)

Grouped as work streams. Not all must ship at once.

### A. Architecture seams (foundation)

- Extract **PlanService**: outline generate / parse / validate / persist typed plan.  
- Extract **BeatRuntime**: one beat = plan slice → events → tools → HITL → world write.  
- Keep **Cast agents** thin: voice + tools + knowledge filter only.  
- Optional later: implement Runtime as an explicit state machine (even without LangGraph).

### B. World model

- Typed world deltas (entity, field, old, new, known_by).  
- Era packs complete for all playable cast (including knowledge facts, not only present_cast).  
- Consistency checks: "character cannot know X" before speak.

### C. Planning quality

- McKee policy stays (DEC-0003).  
- Optional **critic pass** after outline (causal spine, polarity, risk ladder).  
- Player-facing **plan editor** only after Plan is typed data (see §5).

### D. Multi-agent honesty

- Story and Crew: prefer **one sub-agent call per speaker** when quality > cost.  
- Keep single-call multi-cast only as a cheap path with a flag.

### E. Eval and safety

- Golden transcripts: "does this sound like Hank?"  
- Story eval: value turn present; no static beats; no spoiler omniscience.  
- Safety: fictional tools only (already directed).

### F. Experience

- Bind stage events to plan role (show [crisis] without jargon).  
- GIF/voice continue visual audit discipline (OPS).

### G. Product surfaces

- Direct / Crew / Story stay; architecture should not force one UI.  
- McKee editor is a **Plan surface**, not a new Agent runtime.

## 4. Next cut (one layer)

**Next knife: Plan + Runtime seams (A), with a thin World typing spike (B).**

Why this first:

1. McKee craft already improved Plan *policy* but not Plan *module boundaries*.  
2. Director.py size and mixed duties block reliable eval and editor UI.  
3. World typing without Plan/Runtime seams will scatter more free-text fields.  
4. McKee **UI editor** on top of prose outlines will fight the parser forever.

### Explicit non-next

- Full LangGraph migration as the first move.  
- General browser/computer-use Agent.  
- Marie + clone TTS (product cast, not architecture spine).  
- McKee editor UI **before** typed Plan object.

### Acceptance for the next cut (when implemented)

- Plan stored as structured JSON (spine + beats with role/value/gap/risk).  
- Director calls PlanService + BeatRuntime; character agents unchanged at interface.  
- At least one story quality test runs against structured plan (not only string contains).  
- CONTEXT.md / this ADR updated with "as-built" notes.

### As-built notes (2026-07-15 orchestration cut)

**Status of §4 knife:** landed (thin first slice).

| Acceptance | Status |
|------------|--------|
| Structured plan JSON (spine + beats role/value/gap/risk) | **Done** - `StoryPlan` / `BeatPlan` in `backend/agents/plan_service.py`; SSE field `outline.story_plan`; `to_json` / `from_json` round-trip. DB still stores prose `plot_outline`; plan re-parsed on load (deterministic). |
| Director → PlanService + BeatRuntime | **Done** - `process` / `process_next_beat` parse via `PlanService`, run beats via `BeatRuntime`; `_parse_outline` delegates. |
| Character agents unchanged at interface | **Done** - still `respond_structured` path inside `_generate_beat`. |
| Story quality test on structured plan | **Done** - `tests/test_plan_service.py::test_quality_checks_on_structured_plan_not_string_contains`. |
| Docs | **Done** - this section + CONTEXT Agent architecture block. |

**Explicit non-goals of this slice (still deferred):** McKee plan editor UI; hard outline reject; World typed deltas; LangGraph migration; DB `plan_json` column.

## 5. McKee dedicated UI editor (clarified)

**Meaning:** a UI to view/edit the structured story plan (spine fields and beat cards), then start or branch play.

**Dependency:** typed Plan (this ADR §4).  
**Not required for:** proving we have an Agent architecture.  
**Schedule:** after PlanService exists; can be a thin admin/debug panel first, then player-facing.

## 6. Consequences

- Engineering language: say **Plan / World / Cast / Runtime / Experience**, not only "Director did a thing."  
- New features must declare which layer they deepen.  
- Framework adoption (if any) is an **adapter under Runtime**, not a product rewrite.  
- Roughness is diagnosed as **missing seams and typed world**, not as "we are not an Agent product."

## 7. Alternatives rejected

| Alternative | Why not now |
|-------------|-------------|
| "We have no Agent architecture; rewrite on LangGraph first" | False as-is; framework does not supply drama domain |
| "Only add McKee editor UI now" | Edits prose soup; high thrash |
| "Only improve prompts forever" | Hits diminishing returns without state schema |
| "Become general Manus-like Agent" | Different product; dilutes BB narrative bet |

## 8. Sources / inputs

- In-repo: `docs/architecture.md`, code-wiki architecture, DEC-0002/0003, Director/character/provider modules.  
- Craft: McKee *Story* skill pack (local).  
- Industry shape: interactive drama manager literature; multi-agent story planner+speaker patterns; commercial multi-agent SDKs as **runtime plumbing**, not narrative substitutes.  
- Personal wiki themes (Agent long-horizon, verifiable feedback, memory scopes) used as checklists, not copied jargon into product UI.

## 9. Open questions (fog, not tickets yet)

- How strict should Plan validation be in personal-ship mode vs public-ship mode?  
- Cost budget per beat (1 call vs N cast calls)?  
- Whether plot_graph becomes the player-visible Plan map or stays secondary.

---

**One-line summary:**  
We are a **vertical narrative multi-agent theater** with a real but rough custom stack; industry general Agents solve different problems; the next architecture cut is **typed Plan + Beat Runtime seams**, then editor and harder world consistency.
