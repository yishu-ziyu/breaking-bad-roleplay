# Knowledge horizons ↔ Continuity eras

Maps community hub horizons and product world modes to Continuity Board ceilings.
Board remains **session law**; this file is the crosswalk.

## Product eras (existing packs)

| era id | Approx ceiling | Pack |
|--------|----------------|------|
| `s1_early` | Pilot-era / early S1 | `continuity/eras/s1_early.json` |
| `s3_mid` | Fly / Half / Full Measures neighborhood (default sandbox) | `continuity/eras/s3_mid.json` |
| `s5_end` | Late series / aftermath-capable | `continuity/eras/s5_end.json` |

## Horizon labels

| horizon | Meaning | Allowed world_mode (default) | Forbidden |
|---------|---------|------------------------------|-----------|
| `episode_t` | Only facts established through current episode | `canon` (strict); `alternate` if session declares same ceiling | Later-season facts in any mouth |
| `era_pack` | Facts in selected era JSON + session deltas | `alternate` (default), `canon` if pack matches | Out-of-pack show knowledge |
| `incomplete_live` | Audience-incomplete; prediction allowed in **eval only** | n/a runtime | Treating predictions as Board facts |
| `full_series` | Felina-complete BB | `sandbox` with explicit flag; craft tools | Default inject into `s1_early` / `s3_mid` mouths |
| `cross_series` | BB + El Camino + BCS | **Off by default**; optional future pack | Silent default graph |

## Hub → horizon

| Hub id | horizon | Continuity implication |
|--------|---------|------------------------|
| `hub_rewatch_2016_nospoil` | `episode_t` | Gold standard for Validator tests of future-knowledge |
| `hub_live_archive` / live S05 | `incomplete_live` | Soft misread types only |
| `hub_rewatch_2014_fullspoil` | `full_series` | Craft; not early-era runtime |
| `hub_elcamino_2019` | `cross_series` | Default OFF |

## Validator alignment (already shipped)

Hard rejects that implement horizon:

- `knowledge_boundary` — fact `hidden_from` / not `known_by`
- `actor_not_present` / `actor_removed` — cast and irreversible costs
- `forbidden_outcome` — Beat Contract authorial ban

Soft critic does **not** enforce horizon; hard path must run first.

## Defaults (2026-07-22)

- Story default era remains **`s3_mid`** unless session sets otherwise.
- Story default `world_mode` remains **`alternate`** in code.
- **BCS / El Camino** not in default known_by sets.
- Explicit no-spoiler per-episode player mode is **not** default UX; when built, bind to `horizon=episode_t` + `canon`.
