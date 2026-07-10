# Architecture

ABQ Roleplay Lab 是一个由 Vercel 同源托管 React 前端与 FastAPI Python Function 的互动叙事应用。前端负责角色选择、聊天体验、SSE 事件渲染、GIF/语音/场景视觉；后端负责 API、LLM provider 路由、Director Agent、角色 Agent、PostgreSQL 持久化。

## 技术栈

| 层 | 技术 | 主要文件 |
|---|---|---|
| 浏览器应用 | React 19 + TypeScript + Vite | [src/App.tsx](../../src/App.tsx) |
| 前端状态 | React hooks + localStorage + Supabase | [src/hooks](../../src/hooks), [src/lib](../../src/lib) |
| 后端 API | FastAPI + StreamingResponse | [backend/main.py](../../backend/main.py), [backend/api/routes.py](../../backend/api/routes.py) |
| Agent 编排 | DirectorAgent + character agents | [backend/agents/director.py](../../backend/agents/director.py), [backend/agents/characters](../../backend/agents/characters) |
| LLM 抽象 | httpx AsyncClient + provider prefix routing | [backend/agents/provider.py](../../backend/agents/provider.py) |
| 后端数据库 | PostgreSQL + SQLAlchemy async + Alembic | [backend/db](../../backend/db), [backend/alembic](../../backend/alembic) |
| 前端云同步 | Supabase Auth + RLS tables | [supabase/migrations](../../supabase/migrations) |
| 部署 | Vercel Vite static + Python Function | [vercel.json](../../vercel.json), [api/index.py](../../api/index.py) |

## 逻辑分层

```text
Browser
  src/App.tsx
  ├─ Chat view
  │   ├─ useAuth / Supabase persistence
  │   ├─ useCharacterMemory
  │   ├─ sceneBackgrounds / gifResolver / VoicePlayer
  │   └─ POST /api/chat
  └─ Story view
      ├─ useStoryStream
      ├─ POST /api/session/create
      ├─ GET /api/session/{id}/stream
      └─ POST /api/session/{id}/action

FastAPI
  backend/main.py
  └─ backend/api/routes.py
      ├─ chat endpoint
      ├─ session lifecycle
      ├─ SSE stream
      └─ message history recovery

Agent layer
  DirectorAgent
  ├─ outline generation
  ├─ beat planning
  ├─ direct chat
  ├─ crew chat
  ├─ character sub-agent calls
  └─ dossier update

Persistence + providers
  ├─ SQLAlchemy async sessions
  ├─ Alembic migrations
  ├─ Supabase client-side tables
  └─ MiniMax / StepFun / CLIProxy
```

## 主流程 1：Direct Chat

入口：用户在 Chat view 选择角色、关系锚点、语言和模型后发送消息。

```text
App.handleSend
  -> fetch('/api/chat', { mode: 'direct', characterId, relation, history, language, llmProvider, voiceExample })
  -> routes.chat
  -> DirectorAgent.handle_chat_message
  -> DirectorAgent._handle_direct_chat
  -> concrete BaseCharacter.respond_structured
  -> ProviderFacade.call_model
  -> upstream model
  -> structured JSON reply
  -> App renders text + emotion + thinking/tool metadata + GIF + optional voice
```

关键点：

- 角色 ID 在前端使用短 id：`walter`、`jesse`、`skyler`、`saul`、`mike`、`gus`。
- 后端 `FRONTEND_TO_BACKEND_ID` 映射到完整角色名，如 `Walter White`。
- `BaseCharacter.respond_structured()` 要求 LLM 返回 `reply_text`、`emotion_state`、`gif_search_query`、`thinking`、`tool_executed`、`tool_log`。
- 前端聊天历史保存在 localStorage；用户登录后，普通聊天消息和角色记忆同步到 Supabase。

## 主流程 2：Crew Debate

入口仍是 `/api/chat`，但 `mode='crew'`。

```text
App.handleSend
  -> POST /api/chat mode=crew
  -> DirectorAgent._handle_crew_chat
  -> choose participants: selected character + mentioned relevant characters, max 3
  -> CREW_CHAT_SYSTEM_PROMPT asks for JSON array of turns
  -> ProviderFacade.call_model
  -> _parse_crew_debate_logs
  -> frontend id mapping
  -> App appends multiple character messages
```

关键点：

- crew mode 不逐个调用每个角色 Agent，而是由 Director 的 crew prompt 一次性生成 2-3 个角色回合。
- participants 先包含当前角色，再根据用户文本中的 `saul`、`mike`、`gus`、`skyler`、`jesse` 等关键词补充。
- 解析失败会返回空 debate logs；provider 调用失败时后端会生成带 model error 文本的 fallback 角色回合。

## 主流程 3：Story / Director SSE

Story 是项目的核心长期开发方向。它是后端有状态流程，不是 legacy `/api/story` 单次返回。

```text
App.handleStartStory
  -> useStoryStream.startStory(taskPrompt, characterId)
  -> POST /api/session/create
      creates sessions row: status=active, current_mode=story, task_prompt, active_character_id
  -> EventSource('/api/session/{id}/stream')
  -> routes.stream_session
      short DB session loads task_prompt, then releases connection
  -> DirectorAgent.process
      yields status
      generates outline
      parses scenes
      for each scene:
        _generate_beat
        emit scene_change if needed
        Director LLM plans events
        trim noisy events with _prepare_beat_events
        character sub-agents rewrite agent_speak
        persist Message rows
        update CharacterDossier rows
        emit beat_ready
      waits for action_queue between beats
  -> browser renders event feed and BeatControls
```

用户动作：

| Action | 前端 | 后端效果 |
|---|---|---|
| `continue` | 继续下一 beat | session `status=active`，向 `_session_queues[session_id]` 投递 continue |
| `stop` | 停止本地流并清空 saved session | session `status=paused` |
| `redirect` | 提交新剧情方向 | 替换 `task_prompt`，向 Director 投递 redirect，重新生成 outline |
| `switch_perspective` | 切换主视角角色 | 更新 `active_character_id`，Director 下一 beat 尝试让目标角色先说话 |

连接与恢复：

- `useStoryStream` 把 session id 保存在 localStorage key `abq_story_session_id`。
- 页面刷新后先调用 `GET /api/session/{id}/messages` 恢复已持久化的 `agent_speak` 消息。
- 恢复后默认进入 `beat_paused`，等待用户点击 Continue；不会自动重连 SSE。
- SSE 每个事件没有 server-side id，前端用内容合成 dedup key，避免重连时重复显示部分事件。

## 持久化架构

后端 Story 持久化：

```text
sessions
  -> messages
  -> character_states
  -> character_dossiers
```

用途：

- `sessions`：剧情任务、状态、主视角。
- `messages`：Story 模式中已生成的 `agent_speak` 对话，供刷新恢复。
- `character_dossiers`：角色对角色的 session-level 和 world-level 关系记忆。
- `character_states`：预留角色位置/情绪/状态模型。

前端 Supabase 持久化：

```text
auth.users
  -> chat_messages
  -> character_memory
  -> story_sessions
```

用途：

- `chat_messages`：普通 Chat view 的云同步消息。
- `character_memory`：普通 Chat view 的摘要与 key facts。
- `story_sessions`：Supabase 侧旧/预留 story 表；当前 FastAPI Story 主路径没有直接使用它。

## LLM Provider 路由

`ProviderFacade.call_model(messages, model_route)` 使用 `provider/model` 字符串路由：

| Prefix | 上游协议 | 例子 |
|---|---|---|
| `minimax/` | Anthropic-compatible messages | `minimax/MiniMax-M3` |
| `stepfun/` | OpenAI-compatible chat completions | `stepfun/step-3.7-flash` |
| `cliproxy/` | 本地 Anthropic-compatible proxy | `cliproxy/gemini-pro-agent` |

当前行为：

- Story Director 的路由由 `DIRECTOR_MODEL_ROUTE` 配置；Vercel Production 使用 `minimax/MiniMax-M3`。
- Chat 默认 resolver 返回 CLIProxy；前端 `llmProvider` 可覆盖到 MiniMax。
- 后端仍保留 StepFun 支持，尽管当前前端下拉没有暴露 StepFun 选项。

## 当前主路径与遗留路径

| 类型 | 路径 | 状态 |
|---|---|---|
| FastAPI `/api/chat` | [backend/api/routes.py](../../backend/api/routes.py) | 当前 Chat 主路径 |
| FastAPI session/SSE | [backend/api/routes.py](../../backend/api/routes.py) | 当前 Story 主路径 |
| Vercel FastAPI 入口 | [api/index.py](../../api/index.py) | 导出与本地一致的完整 API |
| `backend/scripts/setup_db.py` | [backend/scripts/setup_db.py](../../backend/scripts/setup_db.py) | 本地应急 create_all 脚本；长期 schema 以 Alembic 为准 |

## 主要风险与维护点

- `README.md` 仍有旧 API 名称；Code Wiki 以当前代码为准。
- Story SSE 会进行 LLM 调用；`routes.stream_session` 已避免长时间持有 DB connection，且每次调用仅处理一个 beat。
