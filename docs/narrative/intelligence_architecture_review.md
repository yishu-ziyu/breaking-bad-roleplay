# Narrative intelligence architecture review

**Date:** 2026-07-23  
**Product:** ABQ Roleplay Lab / Breaking Bad roleplay  
**Scope:** What already exists vs Character Intelligence Pack v1 (S1 Walter)

## Current strengths

1. **DEC-0005 pipeline** - Propose → Validate → Repair → Commit separates
   Director Beat Contract, Character Turn Proposal, World Validator hard law,
   and Soft Critic ranking. Training target is policy, not voice karaoke.
2. **Character Policy prompts** - `WALTER_TEMPLATE` + `agents/characters/walter.py`
   already encode mask, engine, contradiction, failure mode, relation tactics,
   knowledge rights, and Continuity obedience.
3. **Continuity Board + era packs** - `materials/breaking-bad/continuity/eras/`
   seed shared facts with `known_by` / `hidden_from` (s1_early, s3_mid, s5_end).
4. **Golden ladder** - 50 adjudicated beats + hard/soft harness under
   `backend/eval/`. Soft taxonomy includes `future_knowledge`, `mask_break_cheap`,
   `volume_first`.
5. **Community discipline (DEC-0006)** - Rewatch hubs are locators and epistemic
   clocks, not canon RAG dumps.

## Current weaknesses

1. **Flat psychology across eras** - One Walter system prompt covers all seasons.
   Era packs change facts; they barely change the decision engine. Risk: S1 mouth
   with S5 confession voice ("I did it because I liked it").
2. **No machine-loaded decision rules** - TEMPLATE markdown is human-facing.
   Runtime only injects Continuity Board + dossier, not era-bound IF/THEN rules
   or Scene DNA agent rules.
3. **Scene storage is golden-only** - Golden beats adjudicate outcomes; they do
   not teach reusable dramatic structure (state before/after + policy rule).
4. **Community → craft path is documented but thin** - Hub index exists; few
   audience-interpretation cards feed soft eval seeds yet.

## Missing knowledge layers (priority)

| Layer | Status | Next |
|-------|--------|------|
| Canon state deltas | Partial (era packs + board) | Keep; do not rebuild wiki |
| Psychology / decision rules | Weak at runtime | **S1 Walter pack (this work)** |
| Relationship power graph | RELATION_MATRIX human | Runtime later |
| Scene DNA | Missing | S1 seed scenes in pack |
| Community interpretations | Locator only | Craft/eval only; never Continuity |
| Voice | Strong enough | Do not expand this cycle |

## Recommended integration points

1. **Loader** - `backend/agents/character_intelligence.py` reads
   `materials/breaking-bad/intelligence/{era_family}/{character}/`.
2. **Injection** - Same seam as Continuity Board: append to `dossier_context`
   inside Director beat Character Policy path (and Direct chat when era is set).
3. **Era gate** - Only packs whose family matches board era (e.g. `s1_*` → `s1/`).
   Never load S5 psychology into S1 sessions.
4. **Eval** - Golden beat for "enough money, quit" with S1 preferred vs S5
   confession loser; Soft Critic penalty for late-arc confession markers when
   `board.era` starts with `s1`.

## Non-goals (this cycle)

- Full-series Character Intelligence for all cast.
- Parallel empty `knowledge/` tree that duplicates `materials/breaking-bad/`.
- Reddit comment dumps or quote karaoke.
- BCS / El Camino default graph.

## Success for Pack v1

- S1 Walter money-quit golden prefers family-rationalization policy over Felina voice.
- Story path injects intelligence block when era is `s1_early`.
- S3/S5 boards do not receive S1-only pack (and no S5 pack exists yet to bleed back).
