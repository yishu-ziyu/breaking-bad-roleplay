---
name: materials_continuity
description: Respect Continuity Board, era packs, and knowledge horizons from materials/breaking-bad.
when_to_use: continuity, 连续, era, horizon, 剧透, board, knowledge, spoiler, s1, s3, s5, 时代, materials
---

# Materials Continuity / Knowledge Horizon

## Source of truth (repo paths)

| Asset | Path | Use |
|-------|------|-----|
| Continuity Board design | `materials/breaking-bad/CONTINUITY_BOARD.md` | Session law: facts, known_by, hidden_from, costs |
| Knowledge horizons | `materials/breaking-bad/continuity/KNOWLEDGE_HORIZONS.md` | What mouths may know |
| Era packs | `materials/breaking-bad/continuity/eras/*.json` | `s1_early`, `s3_mid` (default), `s5_end` |
| Relation matrix | `materials/breaking-bad/RELATION_MATRIX.md` | Stable relationship graph |
| Intelligence packs | `materials/breaking-bad/intelligence/` | Per-character decision rules / forbidden |
| Character templates | `materials/breaking-bad/*_TEMPLATE.md` | Voice + tactics baselines |
| Craft notes | `materials/breaking-bad/craft/` | Pair dynamics, teleplay craft (not runtime law) |

Runtime product SSOT for a live session is the **Board object** (and validator), not free model memory.  
Harness offline tools may approximate; never contradict an explicit Board fact.

## Horizon rules (short)

| horizon | Mouths may use | Forbidden |
|---------|----------------|-----------|
| `episode_t` | Facts through current episode only | Later-season spoilers in any mouth |
| `era_pack` | Selected era JSON + session deltas | Out-of-pack show knowledge as lived memory |
| `full_series` | Felina-complete craft mode | Default inject into early/mid mouths |
| `cross_series` | BB + El Camino + BCS | **Off by default** |

Defaults (product): Story era **`s3_mid`**, world_mode often **`alternate`**. BCS / El Camino not in default known_by.

## Before you speak a "fact"

1. Is it on the Board (or era pack) for this session?
2. Is the speaker in `known_by` and not in `hidden_from`?
3. Would stating it burn a knowledge_boundary / spoiler for the player's era?

If no → withhold, lie in-character, or ask — do not "helpfully" spoil.

## Hard validator alignment (already shipped in product)

- `knowledge_boundary` — fact not known_by speaker
- `actor_not_present` / `actor_removed`
- `forbidden_outcome` — Beat Contract ban

Soft critic does **not** replace hard horizon checks.

## Agent actions

- Prefer tools: `search_continuity`, `recall_dossier`, `list_cast` over inventing cast lists.
- When proposing irreversible violence or outing Heisenberg: mark cost; do not soft-reset next turn.
- Player OOC lore questions: answer as craft only if mode allows; keep diegetic replies era-safe.
