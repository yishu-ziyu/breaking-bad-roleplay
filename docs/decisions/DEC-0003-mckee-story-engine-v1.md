# DEC-0003: McKee Story engine for Story mode

**Status:** accepted (v2 craft push)  
**Date:** 2026-07-15  
**Product:** Breaking Bad Roleplay / ABQ Roleplay Lab

## Context

Story mode previously asked the LLM for a generic numbered scene list. Beats were often static exposition or random vignettes. Loop N added playable Hank; Loop N+1 ships McKee *Story* structure. Craft source: local skill pack  
`…/source_pdf2skill/故事/*` (McKee *Story* extract).

## Decision

### v1
1. Spine meta: `PROTAGONIST`, `SPINE`, `VALUE_PAIR`, `MAJOR_QUESTION`.
2. Playable beats tagged `[setup|inciting|progressive|crisis|climax|resolution]` with `value:` + `gap:`.
3. Per-beat role rules; optional `mckee_role` on events.
4. Module: `backend/agents/mckee_story.py`.

### v2 (skill-pack push)
5. Expand spine: `CONSCIOUS_DESIRE`, `UNCONSCIOUS_DESIRE`, `OPPOSITION`, `CONTROLLING_IDEA` (value + cause).
6. Beats also carry `risk:`; desire ∝ risk; gap cycle; three conflict layers.
7. Emotional polarity alternation soft-check (diminishing returns).
8. Beat planner: scene hinge, inside-out writing, equal opposition fire, crisis dilemma types, climax inevitable+surprise.
9. Outline SSE may include `mckee_spine`, `mckee_warnings`, `mckee_beat_count`.
10. Collapsed outline UI previews spine / controlling idea when present.

## Non-goals

- Full film-scale 40-60 scene treatments
- Separate McKee UI editor
- Changing Direct / Crew chat paths
- Hard auto-reject of outlines (warnings only)

## Consequences

- Outlines longer (meta + 5-7 beats); meta stripped from playable list.
- Legacy plain numbered outlines still parse.
- Redirect / follow-up / branch share McKee discipline.

## Alternatives rejected

- Rewrite frontend event model around McKee types.
- Prompt-only tweak without a dedicated module.
- Block Story until a full treatment UI exists.
