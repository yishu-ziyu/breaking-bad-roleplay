# Breaking Bad Reddit rewatch hubs (index only)

**Status:** curated locators — no comment bodies stored  
**Policy:** `INGEST_POLICY.md`  
**Home subreddit:** https://www.reddit.com/r/breakingbad/

These hubs are **four different epistemic clocks** on the same show.
Mixing them without horizon tags corrupts Continuity and Character Policy.

## Hub table

| id | Epoch | Knowledge horizon | Spoiler discipline | Usable for | Reliability | Entry URL |
|----|-------|-------------------|--------------------|------------|-------------|-----------|
| `hub_bb_sub` | ongoing | mixed | mixed | locator only | low | https://www.reddit.com/r/breakingbad/ |
| `hub_rewatch_2016_nospoil` | 2016 official rewatch | **episode_t only** | **Hard no future spoilers** | `eval`, `craft` | medium (discipline); low (facts) | https://www.reddit.com/r/breakingbad/comments/4rif5u/official_2016_rewatch_breaking_bad_episode/ |
| `hub_rewatch_2014_fullspoil` | 2014–15 official rewatch | **full series through Felina** | **No spoiler ban** (finale allowed) | `craft` (structure/theme); not s1_early runtime | low/medium | https://www.reddit.com/r/breakingbad/comments/1svss0/breaking_bad_episode_discussion_s01e01_pilot/ |
| `hub_live_archive` | air-date live discussions | **information incomplete** | live spoiler tags vary | `eval` (misread / prediction fail types) | low | https://www.reddit.com/r/breakingbad/comments/1kf8g8/breaking_bad_episode_discussion_archive/ |
| `hub_live_s05e01` | S05 premiere live | incomplete → mid-run | IRC + flair | `eval` sample | low | https://www.reddit.com/r/breakingbad/comments/wmc5d/breaking_bad_episode_discussion_s05e01_live_free/ |
| `hub_live_felina` | series finale live | journey end / first full-canon night | optional spoiler tags | `eval`, `craft` (closure reception) | low | https://www.reddit.com/r/breakingbad/comments/1neqth/breaking_bad_episode_discussion_s05e16_felina/ |
| `hub_elcamino_2019` | 2019 full rewatch | full BB + **El Camino / BCS-aware** | future spoilers warned | `craft` only; **default knowledge graph OFF** | low/medium | https://www.reddit.com/r/breakingbad/comments/d4scr1/countdown_to_el_camino_the_brba_series_rewatch/ |
| `hub_elcamino_s01e01` | 2019 per-ep | same as mega | same | craft | low | https://www.reddit.com/r/breakingbad/comments/d4sagi/series_rewatch_thread_s01_e01_pilot/ |
| `hub_elcamino_s01e02` | 2019 per-ep | same as mega | same | craft | low | https://www.reddit.com/r/breakingbad/comments/d4siij/series_rewatch_thread_s01_e02_cats_in_the_bag/ |

## How to open later episodes (no dump required)

| Hub | Pattern |
|-----|---------|
| 2016 no-spoiler | Search: `site:reddit.com/r/breakingbad "Official 2016 Rewatch" "S01E02"` (swap episode) |
| 2014–15 | Title form: `Breaking Bad Episode Discussion S01E02 "Cat's in the Bag..."` |
| Live archive | Follow table links in `hub_live_archive` (S03E02 → S05E16; S1–S2 live posts largely missing) |
| El Camino 2019 | Use mega-thread index (`hub_elcamino_2019`) |

## Epistemic modes (product mapping)

| Mode | Human reading order (recommended) | Product map |
|------|-----------------------------------|-------------|
| A — 2016 no-spoiler | First pass per episode | `era` + episode ceiling; Validator hard tests; optional future `canon` UX |
| C — live archive | After finishing the series | Soft failure taxonomy; golden B "why wrong" |
| B — 2014–15 fullspoil | After finishing the series | Craft / theme; never inject into early-era mouths |
| D — 2019 El Camino | After BB + optional BCS | Cross-series contamination samples; graph off by default |

## What to extract (when curating)

Do extract:

- Knowledge-horizon discipline (who may know what)
- Misread types under incomplete information
- Relationship-tactic debates (self-written summary)
- Room problems / agenda collisions for golden **seeds** (hand-authored)

Do **not** extract:

- "Correct" dialogue lines from top comments
- Meme contests or quote marathons
- Casting gossip as character policy
- BCS facts into default BB Continuity

## Verified hub discipline (primary post text, archive read 2026-07-22)

- **2016 Pilot (`4rif5u`):** explicit *NO spoiler policy* — timeline-locked comments only.
- **2014–15 Pilot (`1svss0`):** explicit *no spoiler policy* (meaning spoilers allowed through Felina).
- **Live archive (`1kf8g8`):** index of live threads from ~S03E02 onward.
- **El Camino mega (`d4scr1`):** full episode index; warns new viewers of future spoilers.

## Never runtime

No hub may be injected into Story SSE, Character system prompts as raw text, or Continuity Board facts without a separate human Continuity PR.
