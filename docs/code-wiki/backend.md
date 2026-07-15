# Backend Code Wiki

后端位于 [backend](../../backend)，是当前项目的主 API 和 Story Agent 运行时。它使用 FastAPI 暴露 `/api/*`，使用 SQLAlchemy async 连接 PostgreSQL，使用 Alembic 管理 schema，使用 `ProviderFacade` 统一调用 LLM。

## 目录结构

```text
backend/
  main.py                  # FastAPI app、lifespan、CORS、生产静态文件托管
  config.py                # Pydantic settings / env validation
  api/
    routes.py              # REST + SSE routes
  agents/
    director.py            # Story Director、direct chat、crew chat
    mckee_story.py         # McKee Story outline/beat planning (DEC-0003)
    provider.py            # MiniMax / StepFun / CLIProxy facade
    memory.py              # session/world dossier 更新
    characters/
      base.py              # BaseCharacter + structured output parser
      walter.py            # WalterWhite prompt
      jesse.py             # JessePinkman prompt
      skyler.py            # SkylerWhite prompt
      saul.py              # SaulGoodman prompt
      mike.py              # MikeEhrmantraut prompt
      gus.py               # GusFring prompt
      hank.py              # HankSchrader prompt
  db/
    session.py             # Async engine/session factory/get_db
    models.py              # SQLAlchemy ORM models
    url.py                 # render_engine_url helper
  models/
    schemas.py             # Pydantic API/SSE schemas
  alembic/
    versions/              # DB migrations
  tests/                   # backend pytest suite
```

## App 入口：[backend/main.py](../../backend/main.py)

主要职责：

- 配置 logging。
- 解析 `ALLOWED_ORIGINS` 并安装 `CORSMiddleware`。
- 在 lifespan 中初始化全局单例：
  - `ProviderFacade(settings)`
  - `DirectorAgent(provider)`
- 关闭时释放 provider 内部 `httpx.AsyncClient`。
- 注册 `backend/api/routes.py`，统一挂载到 `/api`。
- 生产环境下，如果存在 `dist/`，通过 `StaticFiles` 托管构建后的 React SPA。

关键函数：

| 函数 | 作用 |
|---|---|
| `_parse_allowed_origins(raw, app_env)` | 将 `ALLOWED_ORIGINS` 解析为 CORS origin list；生产空值会写 warning |
| `lifespan(app)` | 初始化/清理 Provider 和 Director 单例 |

重要约束：

- app 启动时**不再**执行 `Base.metadata.create_all()`。
- schema 必须通过 `alembic upgrade head` 初始化或升级。
- Docker CMD 已在启动 FastAPI 前执行 Alembic migration。

## 配置：[backend/config.py](../../backend/config.py)

`Settings` 从 `backend/.env` 和环境变量加载配置。

| setting | env | 默认值 | 说明 |
|---|---|---|---|
| `minimax_api_key` | `MINIMAX_API_KEY` | `""` | MiniMax key |
| `stepfun_api_key` | `STEPFUN_API_KEY` | `""` | StepFun key |
| `cli_proxy_base_url` | `CLI_PROXY_BASE_URL` | `http://127.0.0.1:8317` | 本地 CLIProxy base URL |
| `cli_proxy_api_key` | `CLI_PROXY_API_KEY` | `""` | CLIProxy key；为空时 provider 会尝试读取 `~/.cli-proxy-api/config.yaml` |
| `cli_proxy_default_model` | `CLI_PROXY_DEFAULT_MODEL` | `gemini-pro-agent` | CLIProxy 默认模型 |
| `database_url` | `DATABASE_URL` | required | PostgreSQL 连接串 |
| `app_env` | `APP_ENV` | `development` | 控制 dev/prod 行为 |
| `allowed_origins` | `ALLOWED_ORIGINS` | `""` | CORS origin 列表，逗号分隔 |
| `log_level` | `LOG_LEVEL` | `INFO` | Python logging level |

validator 规则：

- `DATABASE_URL` 必须存在。
- `MINIMAX_API_KEY`、`STEPFUN_API_KEY`、`CLI_PROXY_API_KEY` 至少设置一个；否则后端无法调用任何 LLM provider。

## 路由层：[backend/api/routes.py](../../backend/api/routes.py)

路由层通过 `request.app.state.provider/director` 读取 lifespan 创建的单例。

| 路由 | 函数 | 说明 |
|---|---|---|
| `GET /api/health` | `api_health` | 健康检查 |
| `POST /api/session/create` | `create_session` | 创建 Story session |
| `POST /api/session/{session_id}/action` | `session_action` | 控制 beat 流：continue/stop/redirect/switch_perspective |
| `GET /api/session/{session_id}/stream` | `stream_session` | SSE 事件流 |
| `GET /api/session/{session_id}/messages` | `list_session_messages` | 刷新后恢复已持久化 dialogue |
| `POST /api/chat` | `chat` | Direct/Crew 普通聊天 |

### `_session_queues`

模块级 dict：

```python
_session_queues: dict[str, dict] = {}
```

用途：

- 每个活跃 SSE stream 绑定一个 `asyncio.Queue(maxsize=1)`。
- `session_action` 把 continue/redirect/switch_perspective 信号投递给对应 Director。
- `stream_session` finally 中清理 queue，避免内存泄漏。

### `stream_session`

这是最敏感的后端路径。它刻意避免 request-level DB session 持续覆盖整个 SSE 生命周期：

1. 用短生命周期 DB session 检查 session 是否存在并读取 `task_prompt`。
2. 关闭 DB session 后创建 `StreamingResponse`。
3. Director 每个 beat 自己通过 `async_session_factory` 开短 session 写入 messages/dossiers。
4. 每个 SSE 事件前用短 session 读取 `Session.status`，判断用户是否 stop。
5. backend exception 对客户端只返回 `"Internal server error during stream."`，真实 traceback 留在日志中。

维护原则：

- 不要在 SSE generator 外层注入 `Depends(get_db)` 并跨 yield 持有连接。
- 不要把原始异常、API key、DB URL、文件路径直接发给浏览器。
- 修改 event 格式时同步更新 [api.md](./api.md)、[frontend.md](./frontend.md) 和 `src/hooks/useStoryStream.ts`。

## Director Agent：[backend/agents/director.py](../../backend/agents/director.py)

`DirectorAgent` 是后端核心。它同时负责 Story 模式和普通 chat 模式。

### 常量与映射

| 名称 | 说明 |
|---|---|
| `DEFAULT_DIRECTOR_MODEL_ROUTE = "minimax/MiniMax-M3"` | Story Director 默认模型 |
| `MAX_AGENT_SPEAK_PER_BEAT = 2` | 每个 beat 最多保留两个 speak event |
| `FRONTEND_TO_BACKEND_ID` | `walter` -> `Walter White` 等映射 |
| `BACKEND_TO_FRONTEND_ID` | 完整角色名 -> 前端短 id |
| `CHARACTER_AGENTS` | 完整角色名 -> 角色 Agent class |

### Story 方法

| 方法 | 作用 |
|---|---|
| `process(task, session_factory, session_id, action_queue, db)` | Story 主 async generator；生成 outline，逐 beat 产生 SSE events，并在 beat 间等待 action |
| `_generate_outline(task)` | 调 LLM 生成 McKee 大纲（脊柱 meta + 5-7 playable beats；见 `mckee_story`） |
| `_extract_text_from_json_outline(raw)` | LLM 误返回 JSON 时转换成可读 outline |
| `_parse_outline(text)` | 过滤 meta 行后，将 numbered list / JSON fallback 转成 playable scene list |
| `_outline_event(...)` | 通过 `mckee_story.outline_event_payload` 发出 outline SSE（可选 spine/warnings） |
| `_short_scene_name(scene_desc)` | 从 scene 描述中提取场景名 |
| `_generate_beat(...)` | 单个 beat 编排、事件解析、角色 sub-agent 调用、持久化和 `beat_ready` |
| `_prepare_beat_events(events)` | 去掉重复 scene_change、限制 speak 数、过滤空 world deltas |
| `_extract_model_route(event_dict)` | 从 LLM event 的 `recommended_model` 提取 `provider/model` |
| `_parse_beat_events(text)` | 从 fenced/raw JSON 中解析 event array |
| `_persist_beat_writes(...)` | 保存 `Message`，再调用 `update_dossiers`；message commit 先于 dossier 更新 |
| `_beat_ready_event(beat_index, summary)` | 构造 `beat_ready` |

### Chat 方法

| 方法 | 作用 |
|---|---|
| `handle_chat_message(character_id, user_message, context)` | 根据 `context.mode` 分发 direct/crew |
| `_handle_direct_chat(...)` | 调具体角色 Agent，返回单条结构化回复 |
| `_handle_crew_chat(...)` | 选择 1-3 个参与者，一次性生成多人 debate |
| `_parse_crew_debate_logs(raw, participants)` | 解析 crew JSON array，过滤非法角色 |

### Story 事件生命周期

```text
status: Director is analysing...
outline: content
status: outlined N beats...
for each beat:
  scene_change?         # server-side computed if scene name changed
  agent_act*
  agent_think*
  agent_speak*          # Director draft -> concrete character Agent rewrite
  world_state_delta*    # Director concrete deltas and/or memory applied deltas
  beat_ready
  wait action_queue up to 300s
complete
```

`active_character_id` 语义：

- 前端传短 id，如 `jesse`。
- `session_action` 写入 DB 并投递信号。
- Director 将短 id 映射为完整角色名。
- 下一 beat prompt 要求该角色第一个 `agent_speak`。
- 如果 LLM 未遵守，Director 会尝试把该角色的首次 speak hoist 到首个 speak 位置。

## Character Agents：[backend/agents/characters](../../backend/agents/characters)

所有角色继承 `BaseCharacter`。

### `BaseCharacter`

| 项 | 说明 |
|---|---|
| `system_prompt()` | abstract method，具体角色返回自己的 persona prompt |
| `respond_structured(context, user_message, model_route)` | 拼接 system prompt + `STRUCTURED_OUTPUT_PROMPT`，调用 provider，解析结构化输出 |
| `_extract_structured(text)` | 从 fenced/raw JSON 中提取 `reply_text`、`emotion_state` 等字段；失败时把原文作为 reply |

结构化输出字段：

```json
{
  "reply_text": "...",
  "emotion_state": "calm|tense|angry|fearful|manipulative|guilty|resigned|desperate",
  "gif_search_query": "english visual query",
  "thinking": "...",
  "tool_executed": null,
  "tool_log": null
}
```

### 具体角色

| 文件 | class | 角色特点 |
|---|---|---|
| [walter.py](../../backend/agents/characters/walter.py) | `WalterWhite` | 精确、控制、骄傲、以家庭责任合理化 |
| [jesse.py](../../backend/agents/characters/jesse.py) | `JessePinkman` | 情绪化、街头感、愧疚、忠诚冲突 |
| [skyler.py](../../backend/agents/characters/skyler.py) | `SkylerWhite` | 克制、具体追问、家庭风险意识 |
| [saul.py](../../backend/agents/characters/saul.py) | `SaulGoodman` | 快速法律风险 framing、喜剧服务于逃生计算 |
| [mike.py](../../backend/agents/characters/mike.py) | `MikeEhrmantraut` | 简短、专业、保护性、低情绪表达 |
| [gus.py](../../backend/agents/characters/gus.py) | `GusFring` | 礼貌、控制、商业标准式威胁 |
| [hank.py](../../backend/agents/characters/hank.py) | `HankSchrader` | 大声忠诚、家庭保护、调查压力；虚构 `case_pressure_reader` |

## ProviderFacade：[backend/agents/provider.py](../../backend/agents/provider.py)

`ProviderFacade` 把不同上游统一成 `call_model(messages, model_route, max_tokens=4096) -> str`。

| 方法 | 说明 |
|---|---|
| `call_model(messages, model_route, max_tokens)` | 检查 `provider/model` 格式并分发 |
| `_call_minimax(messages, model, max_tokens)` | Anthropic-compatible `/anthropic/v1/messages` |
| `_call_stepfun(messages, model)` | OpenAI-compatible `/v1/chat/completions` |
| `_call_cli_proxy(messages, model, max_tokens)` | 本地 Anthropic-compatible `/v1/messages` |
| `_load_cli_proxy_api_key()` | 从 `~/.cli-proxy-api/config.yaml` 读取第一条 api key |
| `resolve_model_route(scene_context, characters)` | 当前统一返回 `cliproxy/{cli_proxy_default_model}` |
| `close()` | 关闭内部 `httpx.AsyncClient` |

路由格式：

```text
minimax/MiniMax-M3
stepfun/step-3.7-flash
cliproxy/gemini-pro-agent
```

## Memory Layer：[backend/agents/memory.py](../../backend/agents/memory.py)

记忆层维护两种 dossier：

- session-level：`CharacterDossier.session_id = 当前 session id`
- world-level：`CharacterDossier.session_id IS NULL`

关键函数：

| 函数 | 作用 |
|---|---|
| `compute_dossier_delta(provider, dossiers, beat_summary, beat_events, model_route)` | 调 LLM 分析关系变化 |
| `update_dossiers(db, session_id, beat_summary, beat_events, provider, model_route)` | 加载当前 session + world dossiers，应用 deltas，commit |
| `_apply_dossier_delta(dossier, trust_delta, new_knowledge, new_notes)` | 更新 trust、knowledge JSON、relationship notes |
| `_new_dossier(session_id, owner, subject, trust_delta, new_knowledge, new_notes)` | 创建 dossier 行 |
| `_normalize_character_id(value)` | LLM 角色名规范化为 row id |
| `_load_knowledge(value)` | 安全解析 `knowledge` JSON |

容量控制：

- `MAX_KNOWLEDGE_ENTRIES = 50`
- `MAX_RELATIONSHIP_NOTES_CHARS = 2000`

持久化顺序：

1. `_persist_beat_writes` 先保存 `Message` rows 并 commit。
2. 再调用 `update_dossiers`。
3. 如果 dossier 更新失败，只 rollback dossier partial changes，不回滚已提交的 dialogue messages。

## DB Session：[backend/db/session.py](../../backend/db/session.py)

主要行为：

- 读取 `settings.database_url`。
- 如果 URL 是 `postgresql://...`，自动转成 `postgresql+asyncpg://...`。
- 使用 `render_engine_url(..., hide_password=False)` 避免 SQLAlchemy URL 字符串隐藏密码后传给 engine。
- engine 配置：
  - `pool_pre_ping=True`
  - `pool_size=5`
  - `max_overflow=10`
  - dev 环境 `echo=True`
- `get_db()` 是 FastAPI dependency，正常结束 commit，异常 rollback。

## 测试

后端测试位于 [backend/tests](../../backend/tests)。

常用命令：

```bash
cd backend
uv sync
uv run pytest
uv run ruff check .
```

重点测试覆盖：

- config validation 和 CORS parsing
- provider response parsing / model route validation
- route validation / session action / message endpoint
- Director beat parsing、错误脱敏、action queue、perspective semantics
- memory persistence、message 与 dossier commit 顺序
- SSE stream 行为

## 后端开发注意事项

- 修改 Story event schema 时，同时改 Pydantic schema、前端 `useStoryStream` 和 Code Wiki API 文档。
- 修改 DB model 后必须补 Alembic migration，不要依赖 `setup_db.py` 的 create_all。
- 修改 provider fallback 时注意不要把原始 exception 暴露给前端。
- 任何会增加 SSE 持续时间或并发的改动，都要重新检查 DB connection 是否会跨 await/yield 长时间持有。
- 角色 prompt 变更只影响新 LLM 调用；旧 persisted messages 不会回填。
