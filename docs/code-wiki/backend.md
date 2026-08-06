# 后端详解

## 目录结构

```
backend/
├── main.py                    # FastAPI 入口，lifespan 初始化
├── config.py                  # Pydantic Settings — 环境变量配置
├── api/
│   ├── __init__.py
│   └── routes.py              # 所有 API 路由
├── agents/
│   ├── __init__.py             # 导出 ProviderFacade, DirectorAgent, BaseCharacter, 各角色
│   ├── director.py            # DirectorAgent — 剧情引擎核心
│   ├── provider.py            # ProviderFacade — LLM 提供商统一适配
│   ├── mckee_story.py         # McKee Story 引擎 v2 (DEC-0003)
│   ├── memory.py              # 双层记忆系统 (dossier)
│   ├── tools.py               # 原生函数调用框架 (DEC-0001)
│   ├── quota.py               # 免费额度 + IP 限流
│   ├── tts.py                 # MiniMax T2A 语音合成
│   ├── voice_casting.py       # 角色 → 克隆语音 ID 映射
│   ├── speak_sanitize.py      # 对话内容安全过滤
│   ├── beat_json.py           # 节拍 JSON 解析
│   ├── byok_presets.py        # BYOK 提供商预设
│   ├── character_intelligence.py # 角色智能 (社区信号)
│   ├── connection_sessions.py # BYOK 连接会话管理
│   ├── continuity_board.py    # 连续性面板
│   ├── credential_context.py  # 凭证上下文
│   ├── narrative_contracts.py # 叙事契约
│   ├── plot_graph.py          # 剧情图谱
│   ├── auth_user.py           # 用户认证辅助
│   └── characters/            # 8 个角色 Agent
│       ├── __init__.py
│       ├── base.py             # BaseCharacter 抽象基类
│       ├── walter.py           # Walter White
│       ├── jesse.py            # Jesse Pinkman
│       ├── skyler.py           # Skyler White
│       ├── saul.py             # Saul Goodman
│       ├── mike.py             # Mike Ehrmantraut
│       ├── gus.py              # Gus Fring
│       ├── hank.py             # Hank Schrader
│       └── marie.py            # Marie Schrader
├── models/
│   ├── __init__.py
│   └── schemas.py             # Pydantic 请求/响应模型
├── db/
│   ├── __init__.py
│   ├── models.py              # SQLAlchemy ORM 模型
│   ├── session.py             # 异步数据库会话工厂
│   └── url.py                 # 数据库 URL 渲染
├── scenes/
│   ├── __init__.py             # 导出 action_ontology, critic, validator, world_mode
│   ├── action_ontology.py     # 动作本体论 (DEC-0005)
│   ├── critic.py              # 节拍评分器
│   ├── validator.py           # 世界状态验证器
│   ├── state_reducer.py       # 状态归约器
│   └── world_mode.py          # 世界模式解析
├── alembic/                   # 数据库迁移
│   ├── env.py
│   ├── script.py.mako
│   └── versions/              # 迁移版本
├── eval/                      # 黄金节拍评估
│   ├── golden_harness.py
│   └── golden_beats/          # 52 个黄金节拍 JSON
├── tests/                     # 后端测试 (pytest)
│   ├── conftest.py
│   ├── test_director_*.py
│   ├── test_provider_*.py
│   ├── test_character_*.py
│   ├── test_mckee_story.py
│   └── ... 共 40+ 测试文件
└── scripts/
    ├── setup_db.py
    └── smoke_test.sh
```

## 核心模块

### 1. `main.py` — FastAPI 入口

**关键函数**:

| 函数 | 说明 |
|------|------|
| `lifespan(app)` | 异步启动/关闭。初始化 `ProviderFacade`、`DirectorAgent` 单例，注入到 `app.state` |
| `(app 初始化)` | 配置 CORS 中间件、引入 API 路由、生产模式挂载前端静态文件 |

**中间件**: CORS (`CORSMiddleware`) — 允许 config 中配置的 origins

### 2. `config.py` — 配置管理

使用 `pydantic-settings` 从 `.env` 文件加载配置。

**关键配置项**:

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `minimax_api_key` | "" | MiniMax LLM API key |
| `stepfun_api_key` | "" | StepFun LLM API key |
| `cli_proxy_base_url` | "http://127.0.0.1:8317" | CLI Proxy 地址 |
| `director_model_route` | "stepfun/step-3.7-flash" | Director 使用的模型路由 |
| `enable_dossier_updates` | true | 是否启用 Dossier 更新 |
| `database_url` | (必填) | PostgreSQL 连接 URL |
| `free_credits_guest` | 8 | 访客免费额度 |
| `free_credits_user` | 80 | 登录用户每日免费额度 |
| `platform_daily_credit_budget` | 5000 | 平台每日总预算 |
| `platform_rate_limit_per_hour` | 40 | 每 IP 每小时速率限制 |

**验证器**: `_require_at_least_one_api_key` — 至少配置一个 LLM 提供商

### 3. `api/routes.py` — API 路由

**所有端点**:

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/byok/connect` | BYOK 连接注册 |
| POST | `/api/byok/disconnect` | BYOK 断开 |
| GET | `/api/byok/status` | BYOK 状态查询 |
| GET | `/api/quota` | 查询剩余额度 |
| POST | `/api/tts` | 文字转语音 |
| POST | `/api/sessions` | 创建会话 |
| GET | `/api/sessions/{id}` | 获取会话详情 |
| GET | `/api/sessions/{id}/messages` | 获取会话消息历史 |
| POST | `/api/sessions/{id}/action` | 会话动作 (continue/stop/redirect) |
| POST | `/api/chat` | 统一对话端点 (Direct + Crew) |
| POST | `/api/story/start` | 启动故事模式 |
| GET | `/api/story/stream` | SSE 故事流 |
| GET | `/api/story/{id}/state` | 故事状态查询 |

### 4. `agents/director.py` — DirectorAgent (剧情引擎)

**核心类**: `DirectorAgent` — 负责故事大纲生成、节拍派发、角色协调。

**关键方法**:

| 方法 | 说明 |
|------|------|
| `process(task, ...)` | 主入口。异步生成器，产出 `AgentEvent` 事件流 |
| `_generate_outline(task, language)` | 调用 LLM 生成 McKee 故事大纲 |
| `_render_beats(outline_text, ...)` | 解析大纲为节拍列表，逐一处理 |
| `_process_beat(beat, ...)` | 处理单个节拍：调用角色 Agent、更新状态 |
| `_handle_action(action, ...)` | 处理用户动作反馈 |

**输出**: 异步生成器 `AsyncIterator[AgentEvent]`，事件类型包括 `status`, `outline`, `scene_change`, `agent_act`, `agent_speak`, `agent_think`, `beat_ready`, `dossier_update`, `done`, `error`

### 5. `agents/provider.py` — ProviderFacade

**核心类**: `ProviderFacade` — 统一 LLM 提供商接口。

**支持的提供商**:
- `minimax/` — MiniMax-M3 系列
- `stepfun/` — StepFun 系列
- `cliproxy/` — 本地 CLI 代理
- BYOK 预设: 通过 `byok_presets.py` 注册的自定义提供商

**关键方法**:

| 方法 | 说明 |
|------|------|
| `call_model(messages, model_route, max_tokens)` | 标准聊天补全 |
| `call_model_with_tools(messages, model_route, tools)` | 支持函数调用的补全 |
| `close()` | 关闭 HTTP 客户端连接池 |

**模型路由格式**: `{provider}/{model_name}` (如 `stepfun/step-3.7-flash`)

### 6. `agents/characters/base.py` — BaseCharacter

**核心类**: `BaseCharacter(ABC)` — 所有角色 Agent 的抽象基类。

**抽象方法**:
- `system_prompt() -> str` — 返回角色系统提示词

**属性**:
- `tools -> list[Tool]` — 角色可用的函数调用工具
- `tool_executors -> dict[str, ToolExecutor]` — 工具执行器映射

**关键方法**:

| 方法 | 说明 |
|------|------|
| `respond_structured(context, user_message, model_route, voice_example, dossier_context, *, policy_turn)` | 生成结构化回复 (含 JSON 信封) |
| `respond_turn_policy(...)` | Story 模式全 Turn Proposal (act + mind + line) |
| `_run_with_tools(messages, model_route)` | 原生函数调用循环 (最多 4 轮) |

**结构化输出 JSON 格式**:
```json
{
  "reply_text": "对话内容",
  "emotion_state": "angry",
  "gif_search_query": "walter white angry determined",
  "thinking": "内心独白",
  "action": { "verb": "look_at", "target_id": "...", "destination_anchor": null },
  "tool_executed": null,
  "tool_log": null
}
```

### 7. `agents/characters/` — 具体角色 Agent

每个角色继承 `BaseCharacter`，实现:
- `system_prompt()` — 自定义系统提示词，包含角色背景、语气规则、对话风格
- 可选: `tools` / `tool_executors` — 角色特有的函数调用能力

**角色列表**:
- `walter.py` — WalterWhite
- `jesse.py` — JessePinkman
- `skyler.py` — SkylerWhite
- `saul.py` — SaulGoodman
- `mike.py` — MikeEhrmantraut
- `gus.py` — GusFring
- `hank.py` — HankSchrader
- `marie.py` — MarieSchrader

### 8. `agents/mckee_story.py` — McKee Story Engine

**纯函数工具集** (DEC-0003)，提供故事结构驱动的大纲/节拍规划。

**关键函数**:

| 函数 | 说明 |
|------|------|
| `resolve_beat_role(scene_desc, beat_index, total_beats)` | 推断节拍角色 (Inciting Incident / Progressive Complication / Crisis / Climax / Resolution) |
| `extract_beat_role(scene_line)` | 从场景描述行提取节拍角色标签 |
| `infer_beat_role(index, total)` | 根据位置推断节拍角色 |
| `build_outline_user_prompt(task, language, *, active_character)` | 构建大纲生成的用户提示词 |
| `extract_meta(outline_text)` | 从大纲文本提取元信息 |
| `validate_structure(outline_text)` | 验证大纲结构完整 |

### 9. `agents/memory.py` — 记忆系统

**双层记忆系统**:
- **World-level**: 跨会话持久化，`session_id IS NULL` 的 `CharacterDossier` 行
- **Session-level**: 单会话内，`session_id` 关联的 `CharacterDossier` 行

**关键函数**:

| 函数 | 说明 |
|------|------|
| `compute_dossier_delta(provider, dossiers, beat_summary, beat_events, model_route)` | LLM 分析节拍后计算关系变化 |
| `update_dossiers(db, session_id, beat_summary, beat_events, provider, model_route)` | 更新所有级别 dossiers |
| `format_dossier_context(dossiers, character_name)` | 格式化 dossiers 为角色 prompt 上下文 |

**增长上限**: `MAX_KNOWLEDGE_ENTRIES = 50`, `MAX_RELATIONSHIP_NOTES_CHARS = 2000`

### 10. `agents/tools.py` — 函数调用框架

**DEC-0001** 原生函数调用实现，提供商无关。

**核心类**:

| 类 | 说明 |
|----|------|
| `Tool` | 函数调用工具定义 (name, description, parameters_json_schema) |
| `ToolCall` | 模型请求的工具调用 (id, name, arguments) |
| `ToolResult` | 工具执行结果 (content, is_error) |
| `ToolRegistry` | 工具注册/执行管理 |

**关键函数**:

| 函数 | 说明 |
|------|------|
| `translate_tools_to_anthropic(tools)` | Tool → Anthropic 格式 |
| `translate_tools_to_openai(tools)` | Tool → OpenAI 格式 |
| `parse_tool_calls_anthropic(content_blocks)` | 解析 Anthropic 工具调用 |
| `parse_tool_calls_openai(message)` | 解析 OpenAI 工具调用 |
| `tool_result_message(provider_prefix, tool_call, tool_result)` | 构建工具结果消息 |
| `assistant_message_with_tools(provider_prefix, result)` | 构建带工具调用的 assistant 消息 |

### 11. `agents/quota.py` — 配额系统

**动作成本**: `COST_CHAT_DIRECT = 1`, `COST_CHAT_CREW = 2`, `COST_STORY_BEAT = 5`, `COST_TTS = 1`

**限流策略**: 访客 ID (UUID) + IP 哈希双重识别，每小时每 IP 最多 40 次操作。

### 12. `scenes/` — 场景系统 (DEC-0005 P2+)

| 模块 | 说明 |
|------|------|
| `action_ontology.py` | 动作本体论 — 定义允许的动作动词集合 |
| `critic.py` | 节拍评分器 — `prefer_turn()` / `score_turn()` |
| `validator.py` | 世界状态验证器 — `validate_world_turn()` |
| `world_mode.py` | 世界模式 — `WorldMode` 枚举 + 解析 |