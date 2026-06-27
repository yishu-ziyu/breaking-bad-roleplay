# 后端模块说明

## 1. 目录结构

```
backend/
├── main.py                 # FastAPI 应用入口与生命周期
├── config.py               # Pydantic Settings 环境变量
├── api/
│   ├── __init__.py
│   └── routes.py           # REST + SSE 路由
├── agents/
│   ├── __init__.py
│   ├── director.py         # 导演 Agent
│   ├── provider.py         # LLM Provider Facade
│   ├── memory.py           # 记忆与 dossier 管理
│   └── characters/
│       ├── base.py         # 角色基类
│       ├── walter.py
│       ├── jesse.py
│       ├── skyler.py
│       ├── saul.py
│       ├── mike.py
│       └── gus.py
├── db/
│   ├── __init__.py
│   ├── session.py          # SQLAlchemy engine + session
│   └── models.py           # ORM 模型
├── models/
│   ├── __init__.py
│   └── schemas.py          # Pydantic 模型
├── scripts/
│   ├── setup_db.py         # 数据库初始化脚本
│   └── smoke_test.sh       # 部署后冒烟测试
├── tests/                  # pytest 测试
├── pyproject.toml
├── requirements.txt
└── .env.example
```

## 2. 核心类与函数

### 2.1 FastAPI 应用入口

文件：`[backend/main.py](../../backend/main.py)`

| 名称 | 类型 | 说明 |
|------|------|------|
| `lifespan` | async contextmanager | 启动时创建表、初始化 ProviderFacade / DirectorAgent 单例；关闭时释放 HTTP 客户端 |
| `app` | FastAPI | 应用实例，挂载 CORS、API 路由、生产环境静态文件 |

### 2.2 路由层

文件：`[backend/api/routes.py](../../backend/api/routes.py)`

| 名称 | 类型 | 说明 |
|------|------|------|
| `_session_queues` | dict | 运行中 session 的 beat 暂停队列 |
| `get_provider` | Depends | 从 app.state 获取 ProviderFacade |
| `get_director` | Depends | 从 app.state 获取 DirectorAgent |
| `api_health` | GET `/api/health` | 健康检查 |
| `create_session` | POST `/api/session/create` | 创建剧情 session |
| `session_action` | POST `/api/session/{id}/action` | 处理玩家动作：continue/stop/redirect/switch_perspective |
| `stream_session` | GET `/api/session/{id}/stream` | SSE 剧情事件流 |
| `chat` | POST `/api/chat` | 统一聊天端点（direct/crew） |

### 2.3 导演 Agent

文件：`[backend/agents/director.py](../../backend/agents/director.py)`

| 名称 | 类型 | 说明 |
|------|------|------|
| `FRONTEND_TO_BACKEND_ID` | dict | 前端 `walter` → 后端 `Walter White` 映射 |
| `BACKEND_TO_FRONTEND_ID` | dict | 反向映射 |
| `CHARACTER_AGENTS` | dict | 角色名到类映射 |
| `DirectorAgent` | class | 剧情编排核心 |
| `DirectorAgent.__init__` | method | 注入 provider、model_route、system_prompt |
| `DirectorAgent.process` | async generator | 主流程：生成大纲 → 逐 beat 渲染 → 等待玩家动作 |
| `DirectorAgent._generate_outline` | async method | 调用 LLM 生成场景大纲 |
| `DirectorAgent._parse_outline` | static method | 解析编号列表或 JSON 数组为大纲 |
| `DirectorAgent._generate_beat` | async generator | 生成单个 beat 的 SSE 事件 |
| `DirectorAgent._parse_beat_events` | static method | 从 LLM 输出解析 JSON 事件数组 |
| `DirectorAgent.handle_chat_message` | async method | 聊天模式入口 |
| `DirectorAgent._handle_direct_chat` | async method | 单角色私聊 |
| `DirectorAgent._handle_crew_chat` | async method | 多角色辩论 |
| `DirectorAgent._parse_crew_debate_logs` | static method | 解析 crew 返回的 JSON 数组 |

### 2.4 Provider Facade

文件：`[backend/agents/provider.py](../../backend/agents/provider.py)`

| 名称 | 类型 | 说明 |
|------|------|------|
| `ProviderFacade` | class | 统一 LLM 调用层 |
| `__init__` | method | 读取 API key，初始化 httpx.AsyncClient |
| `call_model` | async method | 根据 `model_route` 分发到 MiniMax / StepFun |
| `_call_minimax` | async method | Anthropic-compatible messages API |
| `_call_stepfun` | async method | OpenAI-compatible chat completions |
| `close` | async method | 关闭 HTTP 客户端 |
| `resolve_model_route` | method | 当前固定返回 `stepfun/step-3.7-flash` |

### 2.5 记忆层

文件：`[backend/agents/memory.py](../../backend/agents/memory.py)`

| 名称 | 类型 | 说明 |
|------|------|------|
| `load_world_state` | async function | 加载角色跨 session 的世界状态 |
| `compute_dossier_delta` | async function | 调用 LLM 分析本 beat 中关系变化 |
| `update_dossiers` | async function | 应用并持久化 dossier 变化 |
| `_apply_dossier_delta` | function | 更新单个 dossier 的信任度/知识/备注 |
| `_new_dossier` | function | 创建新 dossier |

### 2.6 角色基类

文件：`[backend/agents/characters/base.py](../../backend/agents/characters/base.py)`

| 名称 | 类型 | 说明 |
|------|------|------|
| `BaseCharacter` | ABC | 所有角色 Agent 的抽象基类 |
| `system_prompt` | abstract method | 返回角色 system prompt |
| `respond` | abstract method | 生成角色回复文本 |
| `respond_structured` | method | 追加 JSON 输出指令并解析结构化字段 |
| `_extract_structured` | function | 从 LLM 输出提取 JSON envelope |

### 2.7 具体角色

文件：`[backend/agents/characters/walter.py](../../backend/agents/characters/walter.py)` 等

每个角色类继承 `BaseCharacter`，实现：

- `system_prompt()`：返回该角色的性格、语气、规则 prompt。
- `respond()`：调用 `provider.call_model()` 生成回复。

现有角色：WalterWhite、JessePinkman、SkylerWhite、SaulGoodman、MikeEhrmantraut、GusFring。

## 3. 配置

文件：`[backend/config.py](../../backend/config.py)`

| 字段 | 环境变量 | 说明 |
|------|----------|------|
| `minimax_api_key` | `MINIMAX_API_KEY` | MiniMax API key |
| `stepfun_api_key` | `STEPFUN_API_KEY` | StepFun API key |
| `database_url` | `DATABASE_URL` | Postgres 连接串 |
| `secret_key` | `SECRET_KEY` | Session/安全密钥 |
| `app_env` | `APP_ENV` | `development` / `production` |
| `allowed_origins` | `ALLOWED_ORIGINS` | CORS 来源，逗号分隔 |

## 4. 数据库会话

文件：`[backend/db/session.py](../../backend/db/session.py)`

| 名称 | 说明 |
|------|------|
| `engine` | async SQLAlchemy engine，自动将 `postgresql` 替换为 `postgresql+asyncpg` |
| `async_session_factory` | session 工厂 |
| `Base` | DeclarativeBase 基类 |
| `get_db` | FastAPI Depends，自动 commit/rollback/close |
