# Design Spec — Breaking Bad Roleplay Demo-Ready Fix

## Overview

Fix 3 critical issues preventing the game from being demo-ready:
1. MiniMax 401 errors blocking all LLM calls
2. Director beat JSON parsing failures
3. SSE stream action endpoint not wired

## Changes

| Commit | Description |
|--------|-------------|
| e73dff2 | feat: beat JSON parsing resilience + StepFun-only routing |
| b4fdd9d | fix: wire SSE action endpoint + StepFun-only routing cleanup |
| 38e2173 | fix: use _short_scene_name for to_scene field |
| 737d1fd | fix: frontend SSE rendering + StoryEvent data mapping |
| 47c5492 | fix: force postgresql+asyncpg driver for Railway DATABASE_URL |

## Verification

| Check | Result |
|-------|--------|
| `uv run pytest` (backend) | 15/15 pass |
| `npm run lint` (frontend) | No issues |
| `npm test` (frontend) | Pre-existing failure on main, not introduced by this branch |

## Open Items

- Manual browser verification: open app, test story mode, chat mode, crew mode
- MiniMax key procurement (separate tracking)
