# CONTEXT — ABQ Roleplay Lab (Breaking Bad Roleplay)

Shared product language for **what already shipped**. Historical roadmaps are not constraints: [docs/PLANNING.md](docs/PLANNING.md).

## Characters (playable)

| id | Display EN | Display ZH | Notes |
|----|------------|------------|--------|
| walter | Walter | 沃尔特 | Empire / pride |
| jesse | Jesse | 杰西 | Conscience / loyalty |
| skyler | Skyler | 斯凯勒 | Family pressure |
| saul | Saul | 索尔 | Criminal lawyer comic |
| mike | Mike | 麦克 | Never 米克 |
| gus | Gus | 古斯 | Controlled threat |
| hank | Hank | 汉克 | DEA; optional Story lead |

## Hank (v1)

- **Modes:** Direct + Crew + Story (selectable protagonist; also supporting cast).
- **Relations:** `family member`, `DEA partner`, `suspect under watch`, `neighbor`, `friend of the family`.
- **Voice:** Loud loyalty — jokes, minerals/beer life texture, protective of family, investigative pressure on suspects, vulnerability under the tough shell. Not a cool generic cop.
- **Assets:** Minimal GIFs (4–8), silhouette/portrait fallback; **no** cloned TTS (browser/default fallback).
- **Safety:** no real DEA how-to. Marie playable / clone TTS / full GIF catalog were loop-scope notes, not a binding next queue ([PLANNING.md](docs/PLANNING.md)).
- **GIF rule:** first-frame visual audit required (no emotion-tag-only random Giphy).

## Story engine (McKee v2 — DEC-0003)

- Module: `backend/agents/mckee_story.py`.
- Spine: PROTAGONIST / SPINE / CONSCIOUS_DESIRE / UNCONSCIOUS_DESIRE / VALUE_PAIR / OPPOSITION / MAJOR_QUESTION / CONTROLLING_IDEA.
- Beats: 5-7 tagged (`setup`→`inciting`→`progressive*`→`crisis`→`climax`→`resolution`) with **value** + **gap** + **risk**.
- Per-beat: role rules, gap cycle, hinge, inside-out, polarity bias, three conflict layers.
- Outline SSE extras: `mckee_spine`, `mckee_warnings`, `mckee_beat_count`.
- Craft source: `…/source_pdf2skill/故事/*` (McKee *Story*).

## Narrative pipeline (DEC-0005 — directional)

**Train policy, not only voice.** Correct = hard constraints × character policy × dramatic goal × world mode (canon | alternate | sandbox).

**Propose → Validate → Repair → Commit** (LLM proposes; symbols verify).

| Role | Output |
|------|--------|
| Director | **Beat Contract** — not final lines |
| Character Policy | **Turn Proposal** (action + **inner_monologue** + speech strategy + line) |
| World Validator | hard legality (`backend/scenes/validator.py`) |
| Narrative Critic | soft score (`scenes/critic.py`) |
| State Reducer | deterministic Continuity Board (`backend/scenes/state_reducer.py`) |

- ADR: `docs/decisions/DEC-0005-propose-validate-commit-narrative.md`
- Contracts: `backend/agents/narrative_contracts.py`
- Scenes package: `backend/scenes/` (ontology, mode, validator, reducer)
- **As-built:** Beat Contract + Character Policy act/think/speak; World Validator; State Reducer-lite; **Soft Critic** (`scenes/critic.py`, weighted 30/25/20/15/10); Golden Beats **50** under `backend/eval/golden_beats/` (hard + soft harness).
- Unshipped stage/3D/SFT ideas in older ADRs are historical, not a must-do ([PLANNING.md](docs/PLANNING.md)).

## Modes

- **Direct:** one character chat with relation anchor.
- **Crew:** multi-character debate.
- **Story:** SSE beat stream; `active_character` can be any playable id including hank.

## Materials / community (DEC-0006)

- **资料 index:** `materials/breaking-bad/SOURCES.md` (active).
- **Rewatch hubs (locator only):** `materials/breaking-bad/community/REWATCH_HUBS.md`.
- **Ingest policy:** link + self-written note only; never comment dumps / Reddit RAG / stage text.
- **Horizons:** `materials/breaking-bad/continuity/KNOWLEDGE_HORIZONS.md`.
- **Soft fail types:** `materials/breaking-bad/eval/SOFT_FAILURE_TAXONOMY.md` → golden `preference_reasons`.
- **Defaults:** BCS/El Camino knowledge graph **off**; no-spoiler episode mode **not** default UX (eval/craft first).
- ADR: `docs/decisions/DEC-0006-community-signal-not-canon.md`.

## Safety

- Fictional drama only; no real-world crime, chemistry, violence, or evasion instructions.
