# Dependencies

本文记录项目的包依赖、外部服务依赖和内部模块依赖关系。具体版本以 [package.json](../../package.json)、[package-lock.json](../../package-lock.json)、[backend/pyproject.toml](../../backend/pyproject.toml)、[backend/uv.lock](../../backend/uv.lock) 为准。

## Frontend npm Dependencies

### Runtime

| Package | 用途 |
|---|---|
| `react` | UI runtime |
| `react-dom` | DOM rendering |
| `@supabase/ssr` | Browser Supabase client helper |
| `@supabase/supabase-js` | Supabase Auth / database client |
| `railway` | Railway CLI/package dependency；不是前端运行时核心 |

### Dev / Build / Test

| Package | 用途 |
|---|---|
| `vite` | 本地 dev server 和生产构建 |
| `@vitejs/plugin-react` | Vite React 插件 |
| `typescript` | TypeScript 编译 |
| `tsx` | Node/TS 测试运行 |
| `eslint` | lint |
| `typescript-eslint` | TypeScript lint rules |
| `eslint-plugin-react-hooks` | React hooks lint |
| `eslint-plugin-react-refresh` | React refresh lint |
| `@playwright/test` | E2E 测试 |
| `@types/*` | Type definitions |

### npm scripts

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "test": "tsx --test 'tests/*.spec.ts' 'test/**/*.test.js' 'src/**/*.test.ts'",
  "preview": "vite preview",
  "e2e": "playwright test",
  "e2e:ui": "playwright test --ui"
}
```

## Backend Python Dependencies

Runtime dependencies from [backend/pyproject.toml](../../backend/pyproject.toml):

| Package | 用途 |
|---|---|
| `fastapi` | API framework |
| `uvicorn[standard]` | ASGI server |
| `sqlalchemy[asyncio]` | ORM + async engine |
| `asyncpg` | PostgreSQL async driver |
| `httpx` | Async LLM HTTP client |
| `pydantic-settings` | `.env`/env settings |
| `python-dotenv` | dotenv support |
| `alembic` | DB migrations |
| `psycopg2-binary` | PostgreSQL tooling compatibility |

Dev dependency group:

| Package | 用途 |
|---|---|
| `pytest-asyncio` | async pytest support |
| `ruff` | Python lint/format checks |

## External Services

| 服务 | 用途 | 配置 |
|---|---|---|
| MiniMax | LLM，Anthropic-compatible messages API | `MINIMAX_API_KEY`, route `minimax/MiniMax-M3` |
| StepFun | LLM，OpenAI-compatible chat completions API | `STEPFUN_API_KEY`, route `stepfun/step-3.7-flash` |
| CLIProxy | 本地/私有 Anthropic-compatible proxy | `CLI_PROXY_BASE_URL`, `CLI_PROXY_API_KEY`, `CLI_PROXY_DEFAULT_MODEL` |
| PostgreSQL | 后端 Story session/messages/dossiers | `DATABASE_URL` |
| Supabase | Auth + 前端普通聊天云同步 | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Giphy-hosted GIFs | 角色情绪卡片 | URLs in `src/roleAssets.ts` |
| Browser Web Speech API | 本地语音播放 | `globalThis.speechSynthesis` |

## Environment Variables

### Backend

| Env | Required | 说明 |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL URL；`postgresql://` 会自动转换为 `postgresql+asyncpg://` |
| `MINIMAX_API_KEY` | conditional | 至少一个 LLM key 必须存在 |
| `STEPFUN_API_KEY` | conditional | 至少一个 LLM key 必须存在 |
| `CLI_PROXY_API_KEY` | conditional | 至少一个 LLM key 必须存在；为空时可从本机 CLIProxy config 读取 |
| `CLI_PROXY_BASE_URL` | no | 默认 `http://127.0.0.1:8317` |
| `CLI_PROXY_DEFAULT_MODEL` | no | 默认 `gemini-pro-agent` |
| `APP_ENV` | no | `development` / `production` |
| `ALLOWED_ORIGINS` | no | CORS origin list；生产应显式设置 |
| `LOG_LEVEL` | no | 默认 `INFO` |
| `PORT` | deploy | `start.py` 读取，默认 `8080` |

### Frontend

| Env | Required | 说明 |
|---|---|---|
| `VITE_SUPABASE_URL` | no | Supabase URL；缺失时 guest mode 仍可用 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | no | Supabase publishable key；缺失时 `createClient()` 返回 null |

## Internal Module Dependencies

### Frontend

```text
src/main.tsx
  -> src/App.tsx
      -> hooks/useAuth
          -> lib/supabaseClient
      -> hooks/useCharacterMemory
      -> hooks/useStoryStream
      -> lib/persistedState
      -> lib/voiceExamples
      -> lib/supabasePersistence
          -> lib/supabaseClient
      -> lib/sceneBackgrounds
      -> lib/gifResolver
          -> roleAssets
      -> lib/silhouette
      -> components/AuthSection
      -> components/GifCard
      -> components/VoicePlayer
          -> lib/voicePlayerHelpers
      -> roleProfiles
```

### Backend

```text
backend/main.py
  -> config.settings
  -> api.routes.router
  -> db.models                       # registers Base metadata
  -> db.session.engine
  -> agents.provider.ProviderFacade  # lifespan singleton
  -> agents.director.DirectorAgent   # lifespan singleton

backend/api/routes.py
  -> db.session.get_db / async_session_factory
  -> db.models.Session / Message
  -> agents.provider.ProviderFacade
  -> agents.director.DirectorAgent
  -> models.schemas

backend/agents/director.py
  -> agents.provider.ProviderFacade
  -> agents.characters.*
  -> agents.memory.update_dossiers
  -> models.schemas.AgentEvent

backend/agents/characters/base.py
  -> agents.provider.ProviderFacade

backend/agents/memory.py
  -> db.models.CharacterDossier / CharacterState / Session
  -> ProviderFacade-compatible provider

backend/db/session.py
  -> config.settings
  -> db.url.render_engine_url
```

## Runtime Calling Chains

### Direct Chat

```text
App.handleSend
  -> fetch('/api/chat')
  -> routes.chat
  -> DirectorAgent.handle_chat_message
  -> DirectorAgent._handle_direct_chat
  -> character_cls(self.provider).respond_structured
  -> ProviderFacade.call_model
  -> provider-specific HTTP API
```

### Crew Chat

```text
App.handleSend
  -> fetch('/api/chat')
  -> routes.chat
  -> DirectorAgent._handle_crew_chat
  -> ProviderFacade.call_model
  -> DirectorAgent._parse_crew_debate_logs
  -> App appends debate logs
```

### Story SSE

```text
useStoryStream.startStory
  -> POST /api/session/create
  -> EventSource('/api/session/{id}/stream')
  -> routes.stream_session
  -> DirectorAgent.process
      -> _generate_outline
      -> _generate_beat
          -> ProviderFacade.call_model                 # Director planner
          -> BaseCharacter.respond_structured          # character dialogue
          -> _persist_beat_writes
              -> db.models.Message
              -> update_dossiers
                  -> compute_dossier_delta
                  -> ProviderFacade.call_model         # relationship analysis
```

### Story Action

```text
BeatControls
  -> useStoryStream.sendAction
  -> POST /api/session/{id}/action
  -> routes.session_action
      -> update Session row
      -> optionally put signal in _session_queues[session_id]
  -> DirectorAgent.process consumes action_queue
```

## Provider-Specific Dependencies

### MiniMax

Endpoint:

```text
https://api.minimaxi.com/anthropic/v1/messages
```

Headers:

```text
Content-Type: application/json
anthropic-version: 2023-06-01
x-api-key: MINIMAX_API_KEY
```

Response parser:

- expects `content` list
- concatenates text blocks with `type == "text"`

### StepFun

Endpoint:

```text
https://api.stepfun.com/v1/chat/completions
```

Headers:

```text
Authorization: Bearer STEPFUN_API_KEY
Content-Type: application/json
```

Response parser:

- expects `choices[0].message.content`

### CLIProxy

Endpoint:

```text
{CLI_PROXY_BASE_URL}/v1/messages
```

Headers:

```text
Content-Type: application/json
anthropic-version: 2023-06-01
x-api-key: CLI_PROXY_API_KEY
```

Request transform:

- system messages are concatenated into Anthropic `system`
- user/assistant messages stay in `messages`

Response parser:

- reads content blocks with `type in ("text", "thinking")`
- concatenates `text` or `thinking`

## Test Dependencies

| Area | Command |
|---|---|
| Frontend unit/integration | `npm test` |
| Frontend lint | `npm run lint` |
| Frontend build | `npm run build` |
| Playwright E2E | `npm run e2e` |
| Backend tests | `cd backend && uv run pytest` |
| Backend lint | `cd backend && uv run ruff check .` |

## Dependency Risks

- Frontend Vite build expects all referenced public assets to exist. `sceneBackgrounds.ts` references `/backgrounds/blue-desert-rv.jpg`; verify the file exists before relying on that background.
- StepFun is supported by backend but not exposed in current model dropdown.
- CLIProxy local default will fail unless the proxy is running and a key is configured.
- Giphy GIFs are externally hosted and can disappear or fail regionally; `GifCard` hides broken images but UX degrades.
- Supabase not configured is valid guest mode; auth-related code should keep treating it as optional.
- Backend cannot import settings without `DATABASE_URL`; tests set env defaults in test modules/conftest.
