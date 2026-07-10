# ABQ Roleplay Lab Code Wiki

更新时间：2026-07-10

本项目是一个《Breaking Bad》风格的 AI 角色扮演原型，正式名称建议使用 **ABQ Roleplay Lab**。它不是单一聊天 Demo，而是一个 React 前端 + FastAPI 后端 + PostgreSQL 记忆层的互动叙事系统：

- Chat 视图：用户选择 Walter、Jesse、Skyler、Saul、Mike、Gus，与角色进行 direct chat 或 crew debate。
- Story 视图：用户给出剧情任务，后端 Director Agent 生成 outline，并通过 SSE 逐 beat 推送 `scene_change`、`agent_think`、`agent_speak`、`world_state_delta`、`beat_ready` 等事件。
- 记忆层：普通聊天有前端 localStorage/Supabase 持久化；Story 模式有后端 SQLAlchemy/Alembic 的 session、message、dossier 持久化。
- LLM 层：后端统一经 `ProviderFacade` 调用 MiniMax、StepFun 或本地 CLIProxy。

## 文档导航

| 文档 | 内容 |
|---|---|
| [architecture.md](./architecture.md) | 整体架构、主要运行链路、当前主路径与遗留路径 |
| [backend.md](./backend.md) | FastAPI、DirectorAgent、ProviderFacade、角色 Agent、记忆层职责 |
| [frontend.md](./frontend.md) | React 入口、双视图状态流、hooks、组件、前端持久化 |
| [api.md](./api.md) | REST API、SSE 事件协议、请求/响应结构 |
| [data-models.md](./data-models.md) | SQLAlchemy 模型、Pydantic schema、Supabase 表、localStorage key |
| [dependencies.md](./dependencies.md) | npm/Python 依赖、外部服务、模块依赖关系 |
| [deployment.md](./deployment.md) | 本地运行、迁移、测试与 Vercel 主生产部署 |

## 快速代码地图

| 路径 | 职责 |
|---|---|
| [src/App.tsx](../../src/App.tsx) | 前端主入口，管理 Chat/Story 双视图、角色选择、模型选择、消息渲染 |
| [src/hooks/useStoryStream.ts](../../src/hooks/useStoryStream.ts) | Story 模式的 session 创建、SSE 连接、恢复、beat action |
| [src/hooks/useAuth.ts](../../src/hooks/useAuth.ts) | Supabase email/password auth |
| [src/hooks/useCharacterMemory.ts](../../src/hooks/useCharacterMemory.ts) | 前端聊天滑窗记忆与摘要 |
| [src/lib/supabasePersistence.ts](../../src/lib/supabasePersistence.ts) | 前端聊天消息和角色记忆的 Supabase 持久化 |
| [src/lib/gifResolver.ts](../../src/lib/gifResolver.ts) | 按角色、情绪、GIF query 选择视觉素材 |
| [backend/main.py](../../backend/main.py) | FastAPI app、CORS、lifespan singletons、生产静态文件托管 |
| [backend/api/routes.py](../../backend/api/routes.py) | `/api/*` 路由：health、session、SSE、chat |
| [backend/agents/director.py](../../backend/agents/director.py) | Story Director 与 direct/crew chat 编排核心 |
| [backend/agents/provider.py](../../backend/agents/provider.py) | MiniMax / StepFun / CLIProxy 统一调用层 |
| [backend/agents/characters/](../../backend/agents/characters) | 六个角色 Agent 的 system prompt 与结构化输出解析 |
| [backend/agents/memory.py](../../backend/agents/memory.py) | session/world 双层 dossier 更新 |
| [backend/db/models.py](../../backend/db/models.py) | 后端 Story 持久化 ORM 模型 |
| [backend/alembic/](../../backend/alembic) | 后端 PostgreSQL schema migration |
| [api/index.py](../../api/index.py) | Vercel Python Function 入口，导出完整 FastAPI app |

## 当前主运行链路

Chat：

```text
Browser src/App.tsx
  -> POST /api/chat
  -> backend/api/routes.py:chat
  -> DirectorAgent.handle_chat_message
  -> character agent 或 crew prompt
  -> ProviderFacade
  -> MiniMax / StepFun / CLIProxy
```

隐私边界和云端加密策略见 [docs/PRIVACY_MODEL.md](../PRIVACY_MODEL.md)。

Story：

```text
Browser src/hooks/useStoryStream.ts
  -> POST /api/session/create
  -> GET /api/session/{id}/stream  (EventSource)
  -> DirectorAgent.process
  -> Director LLM outline + beat planner
  -> character sub-agents
  -> Message + CharacterDossier persistence
  -> SSE events back to browser
```

## 重要维护结论

- **Story 主路径是 FastAPI session + SSE**。Vercel 通过 `api/index.py` 导出同一个 app，不再维护重复的 legacy serverless API。
- **后端 schema 以 Alembic 为准**。`backend/main.py` 不再启动时 `create_all`；Docker 启动命令会先跑 `alembic upgrade head`。
- **Supabase 表和后端 SQLAlchemy 表不是同一套 schema**。Supabase 主要支持前端账号、普通聊天记录、前端角色记忆；后端 PostgreSQL 表支持 Story session、message、dossier。
- **LLM provider 现支持 MiniMax、StepFun、CLIProxy**。前端模型下拉当前显示 `cliproxy` 和 `minimax`，后端仍能处理 `stepfun` 请求。
- **每个 Vercel Story 请求只生成一个 beat**。进度由 Postgres 持久化，不依赖函数实例内存。
