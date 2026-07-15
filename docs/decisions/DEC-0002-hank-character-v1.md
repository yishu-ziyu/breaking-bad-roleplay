# DEC-0002: Hank Schrader as playable character (v1)

**Status:** accepted  
**Date:** 2026-07-15  
**Product:** Breaking Bad Roleplay / ABQ Roleplay Lab

## Context

Cast was six playable characters. Players need a DEA / family-pressure axis that bites Walter/Jesse/Skyler lines hard. Story quality will later lean on McKee *Story*, but that is a separate engine loop.

## Decision

1. Add **Hank Schrader** (`hank` / `Hank Schrader` / 汉克) as a first-class playable character.
2. v1 surfaces: **Direct + Crew + Story**, with Story allowing Hank as **selected protagonist** or supporting cast.
3. Relation anchors (5): family member, DEA partner, suspect under watch, neighbor, friend of the family.
4. Voice axis: **loud loyalty** (not generic cool cop).
5. Assets: minimal curated GIFs + TTS fallback (no clone required for merge).
6. **Serial roadmap:** Loop N = Hank full registration on **current** director; Loop N+1 = McKee beat/director redesign.

## Consequences

- Touch frontend `CharacterId` surfaces, `roleProfiles` / `roleAssets`, App cast list, voice helpers, backend character agent, director maps, continuity aliases, tests.
- GIF pool must pass visual role check before production claim (OPS_RUNBOOK).
- Marie, clone TTS, and McKee engine are explicitly deferred.

## Alternatives rejected

- Direct-only Hank (too thin for agreed C scope).
- Parallel Hank + full McKee rewrite (unshippable batch).
- McKee-first before any new cast (delays DEA axis with no player-visible cast win).
