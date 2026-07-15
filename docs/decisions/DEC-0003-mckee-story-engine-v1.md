# DEC-0003: McKee Story engine v1 for Story mode

**Status:** accepted  
**Date:** 2026-07-15  
**Product:** Breaking Bad Roleplay / ABQ Roleplay Lab

## Context

Story mode previously asked the LLM for a generic numbered scene list. Beats were often static exposition or random vignettes. Loop N added playable Hank; Loop N+1 was reserved for McKee *Story* structure.

## Decision

1. Story outline generation uses McKee spine fields: `PROTAGONIST`, `SPINE`, `VALUE_PAIR`, `MAJOR_QUESTION`.
2. Playable beats are numbered lines tagged with  
   `[setup|inciting|progressive|crisis|climax|resolution]`, plus `value:` turn and `gap:`.
3. Per-beat planning injects role-specific rules (value turn + expectation/result gap).
4. SSE event schema stays the same; optional `mckee_role` may appear on `scene_change` / `beat_ready`.
5. Implementation lives in `backend/agents/mckee_story.py`; `DirectorAgent` wires prompts and parse filtering.

## Non-goals (v1)

- Full film-scale 40-60 scene treatments
- Separate McKee UI editor or beat-card redesign
- Changing Direct / Crew chat paths
- Automated quality scoring of value turns against the book checklist

## Consequences

- Outlines may be longer (meta + 5-7 beats) but meta lines are stripped from the playable scene list.
- Legacy plain numbered outlines still parse.
- Redirect / follow-up / branch prompts share McKee discipline.

## Alternatives rejected

- Rewrite the entire frontend event model around McKee types (too large for one loop).
- Prompt-only tweak without a dedicated module (hard to test and regress).
- Block Story until a full treatment/workflow UI exists (delays player-visible quality).
