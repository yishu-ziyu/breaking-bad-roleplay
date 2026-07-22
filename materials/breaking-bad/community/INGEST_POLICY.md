# Community signal ingestion policy

**Status:** active (2026-07-22)  
**Layer:** Community / Critical (see `DESIGN.md`)  
**Related:** `REWATCH_HUBS.md`, `SOURCES.md`, `docs/decisions/DEC-0006-community-signal-not-canon.md`

## One rule

Community discussion is **signal for craft and evaluation**, never session law and never player-facing canon.

```text
Reddit / wiki talk
  → link + cluster + self-written note (资料)
  → optional: soft failure taxonomy / golden seed / policy draft (人工)
  → never: Continuity Board fact, default RAG, SSE stage text
```

## Allowed to store

| Store | Example |
|-------|---------|
| Thread URL + post id | `https://www.reddit.com/r/breakingbad/comments/4rif5u/…` |
| Episode locator | `S01E01`, title |
| Hub epoch label | `rewatch_2016_nospoil` |
| Knowledge horizon | `episode_t` / `full_series` / `incomplete_live` / `cross_series` |
| `usable_for` | `eval` \| `craft` \| `never_runtime` |
| Reliability | `low` \| `medium` (community is never `high` for world facts) |
| Self-written cluster notes | "First-watch audience often misreads Walt as purely sacrificial" |
| Soft failure taxonomy ids | `plot_dump`, `future_knowledge`, `volume_first` |

## Forbidden to store

- Long comment bodies or full thread dumps
- Quote banks of episode dialogue scraped from comments
- Automatic writes into `*_TEMPLATE.md` or era JSON
- Embedding indexes of raw Reddit text
- Runtime prompts that say "Reddit users think…"

## Promotion path (human only)

1. Curator reads hub under its **stated spoiler discipline**.
2. Writes a **self-authored** note (no long paste).
3. Tags `usable_for` and horizon.
4. If it changes hard knowledge → open a Continuity / era PR with cross-check against primary sources.
5. If it only changes soft preference → add golden beat `preference_reasons` or taxonomy entry.
6. If it only clarifies voice/tactics → optional TEMPLATE edit with source_ref link, not quote.

## Defaults (product decisions, 2026-07-22)

| Decision | Default |
|----------|---------|
| BCS / El Camino in default knowledge graph | **Off** |
| Ship no-spoiler per-episode player mode | **Not default UX**; 2016 hub serves **eval + craft** until an explicit product mode ships |
| Auto-scrape Reddit | **No** |
| Community as Board fact | **Never** |

## Reliability

| reliability | Use |
|-------------|-----|
| low | Locator only; always re-verify |
| medium | Soft pattern candidate after human rewrite |
| high | **Do not assign** to pure community threads for world facts |

## Copyright and ToS

- Prefer link + self-written summary (aligned with `SOURCES.md` red lines).
- Do not bulk-mirror Reddit for redistribution.
- Episode dialogue inside comments is still show IP — do not harvest as training lines.
