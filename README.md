# ABQ Roleplay Lab

《绝命毒师》主题的 AI 角色扮演。当前默认入口和玩法见 [docs/AS_BUILT.md](docs/AS_BUILT.md)：无参数打开是 Story / Direct / Crew 三卡展台。进入 Direct / Crew 后可以选角色、建关系再聊；Story 先进入场面卡。六回合夜晚已实现，只走 `?night=1`，不是默认首页。

三个模式，不是一条强制联通的游戏流程：Direct 是一对一 AI 角色聊天，Crew 是多角色 AI 聊天，Story 才采用「局势 → 行动 → 结算 → 后果」的叙事游戏循环。聊天对象、记录和私聊记忆不随 Story 玩家身份或进度改变。

## What It Does

- Default visit: a three-card Story / Direct / Crew showcase.
- Story: a Director-led scene pauses for the player's action, then runtime-v1
  settles a finite world state before any public event is streamed.
- Direct: one-on-one character conversation with a relationship anchor, core
  character policy and bounded durable memory.
- Crew: independent multi-character conversation, not a mandatory Story encounter.
- English and Simplified Chinese UI, prompts and replies.
- Platform quota plus BYOK provider binding; provider keys stay on the server
  or in the browser's encrypted connection vault.
- The UI currently exposes eight portraits including Marie. The production
  Director roster is still seven characters; see the known mismatch in
  `docs/AS_BUILT.md` before changing that boundary.

## Current Architecture

### Story runtime v1

```text
player command
  -> story.service claim + revision/idempotency check
  -> scenes.world_state deterministic resolution
  -> Director / Character policy performance
  -> validation
  -> atomic world snapshot + story_turns outbox commit
  -> SSE replay of committed public events
```

New sessions use this path. Pre-migration sessions with no `world_state` keep
the legacy beat runtime so existing saves remain readable.

### Direct and Crew

`POST /api/chat` routes through `DirectorAgent`, compiled character policy and
the shared accepted-turn validator. Direct uses a lean no-tool presentation
stack, but it does not bypass identity, knowledge or publication gates.

The standalone chat entry filters out Story session/world fields and does not
read a Story save. Local and encrypted cloud chats use the same versioned key,
`chat-v2:<direct|crew>:<NPC id>`, in the existing text `character_id` storage
column. `/api/chat` still receives the canonical NPC id. Unclassified legacy
records are preserved in a separate read-only archive; they are not silently
assigned to either mode or injected into new conversations. No database
migration is needed for this key separation. See
[`chat-story-mode-boundaries.md`](docs/specs/chat-story-mode-boundaries.md).

### Durable memory

Direct stores a bounded set of attributed conversation facts in five categories:
open thread, secret, attitude shift, player fact and agreement. These are
retrieved as untrusted conversation data, not promoted to system instructions
or authoritative Story effects.

The load-bearing boundaries are documented in
[`docs/architecture/layering.md`](docs/architecture/layering.md).

## Safety Boundary

Because this topic involves crime-drama characters, the system prompt explicitly blocks real-world instructions for crimes, violence, evasion, chemistry procedures, drug production, money laundering, weapons, or operational wrongdoing. The app should keep those moments as fictional dramatic tension.

## Run Locally

### Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL (local or remote)
- [uv](https://docs.astral.sh/uv/) for Python dependency management

### Frontend

```bash
npm install
npm run dev
```

The frontend runs on `http://localhost:5176`.

### Backend

```bash
cd backend
uv sync
uv run python -m uvicorn main:app --reload --port 8001
```

The FastAPI backend runs on `http://localhost:8001`.

Schema is owned by Alembic — the app never creates tables at startup. Apply
migrations before the first start (and after every pull that adds one):

```bash
cd backend
uv run python -m alembic upgrade head
```

The backend checks the database revision at startup: when the database is
behind the migration head it logs the exact upgrade command and exits with a
non-zero status instead of serving `UndefinedColumnError` 500s later.

> **Path caveat:** `uv run alembic ...` and `uv run uvicorn ...` execute the
> venv console scripts, whose shebang is an absolute path baked in at install
> time. If the repository path contains a space (or the folder was renamed
> after `uv sync`), that shebang is broken, and `uv run` either fails with
> `Failed to spawn: alembic` or silently falls back to another interpreter's
> uvicorn. `uv run python -m alembic ...` / `uv run python -m uvicorn ...`
> bypass the console scripts entirely.

Make sure `.env` is configured in `backend/` with the required API keys (`MINIMAX_API_KEY`, `STEPFUN_API_KEY`, `DATABASE_URL`).

### Verification

```bash
npm test
npm run test:backend
npm run build
npm run lint
npm run test:e2e
npm run test:e2e:auth
```

`test:e2e` executes only current product contracts. Historical selectors and
the migration map are preserved under `docs/archive/e2e/2026-09-17/`.
The auth/profile contract uses an isolated fake Supabase origin and runs through
`test:e2e:auth`; `test:ci` includes both browser suites.

## API

The Python backend exposes the following endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Direct or Crew message |
| `/api/session/create` | POST | Create a Story session and runtime-v1 opening command |
| `/api/session/{id}/action` | POST | Submit `act`, continue, stop, redirect, branch, replay, or perspective change |
| `/api/session/{id}/stream` | GET | Stream or replay committed Story events over SSE |
| `/api/session/{id}/state` | GET | Restore player-visible world state and the committed branch outbox |
| `/api/session/{id}/messages` | GET | Paginated persisted dialogue / legacy recovery |
| `/api/session/{id}/plot-graph` | GET | Player-facing situation map |
| `/api/quota` | GET | Current platform/BYOK quota state |

Runtime-v1 public events include `outline`, `player_turn`, `scene_change`,
accepted character performance, `beat_ready`, and `complete`. Event IDs are
stable within a command so reconnects do not duplicate the manuscript.

## MiniMax Token Plan

The app calls MiniMax through the Python backend proxy so API keys are never exposed in the browser.

Local setup:

```bash
cp .env.example .env.local
# set MINIMAX_TOKEN_PLAN_KEY to your real Token Plan Key
```

- Backend proxy: `POST /api/chat` (Python FastAPI)
- Upstream endpoint: `https://api.minimaxi.com/anthropic/v1/messages`
- Model: `MiniMax-M3`
- Key location: `.env` in `backend/` locally or environment variables in deployment.

## Material Library

The project-local Breaking Bad material library lives in `materials/breaking-bad/`.

- `DESIGN.md`: retrieval-library architecture and copyright-safe layering.
- `SOURCES.md`: source directory for official pages, creator interviews, podcasts, critical analysis, wiki references, and licensing routes.
- `INGESTION_SCHEMA.md`: JSONL schemas for sources, episodes, voice rules, production notes, relationship dynamics, and retrieval units.
