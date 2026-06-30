# API Reference

当前主 API 由 FastAPI 提供，文件是 [backend/api/routes.py](../../backend/api/routes.py)，统一 prefix 为 `/api`。Vercel serverless 下的 [api/chat.py](../../api/chat.py) 和 [api/story.py](../../api/story.py) 是遗留路径，见本文末尾。

## 通用约定

- JSON REST endpoint 使用 `Content-Type: application/json`。
- Story stream 使用 `text/event-stream`。
- 后端对外错误会脱敏；原始异常只写入 server log。
- Story session id 是 UUID 字符串。
- 角色短 id：`walter`、`jesse`、`skyler`、`saul`、`mike`、`gus`。
- 后端完整角色名：`Walter White`、`Jesse Pinkman`、`Skyler White`、`Saul Goodman`、`Mike Ehrmantraut`、`Gus Fring`。

## GET `/api/health`

健康检查。

Response：

```json
{
  "status": "ok",
  "service": "breaking-bad-roleplay"
}
```

## POST `/api/session/create`

创建 Story session。当前前端 `useStoryStream.startStory()` 会先调用这个 endpoint，再连接 SSE。

Request：

```json
{
  "title": "Walter needs a new methylamine supply",
  "task_prompt": "Walter White needs to secure a new methylamine supply from Gus Fring without Skyler finding out.",
  "active_character_id": "walter"
}
```

Schema：[backend/models/schemas.py](../../backend/models/schemas.py) `SessionCreate`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | yes | session 标题 |
| `task_prompt` | string | yes | Director 任务描述 |
| `active_character_id` | string/null | no | 当前主视角，前端短 id |

Response：

```json
{
  "session_id": "uuid",
  "title": "Walter needs a new methylamine supply",
  "status": "active",
  "created_at": "2026-07-01T00:00:00"
}
```

创建时后端写入 `sessions`：

- `status = "active"`
- `current_mode = "story"`
- `task_prompt = payload.task_prompt`
- `active_character_id = payload.active_character_id`

## GET `/api/session/{session_id}/stream`

Story SSE 事件流。当前 Story 主路径。

Request：

```http
GET /api/session/1f7.../stream
Accept: text/event-stream
```

Response headers：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

SSE frame 格式：

```text
event: agent_speak
data: {"type":"agent_speak","data":{"character_id":"Walter White","content":"...","emotion_state":"tense","gif_search_query":"walter white nervous serious"},"model_route":"minimax/MiniMax-M3"}
```

`data` 是 `AgentEvent` JSON：

```json
{
  "type": "agent_speak",
  "data": {},
  "model_route": "minimax/MiniMax-M3"
}
```

### 事件类型

| Event | `data` shape | 说明 |
|---|---|---|
| `status` | `{ "message": string, ... }` | Director 状态、等待用户、停止等 |
| `outline` | `{ "content": string }` | Story outline |
| `scene_change` | `{ "from_scene": string, "to_scene": string, "description": string }` | 场景变化 |
| `agent_act` | `{ "character_id": string, "action": string, "target": string|null }` | 角色动作 |
| `agent_think` | `{ "character_id": string, "thought_content": string }` | 角色内心 |
| `agent_speak` | `{ "character_id": string, "content": string, "emotion_state": string, "gif_search_query": string }` | 角色台词 |
| `world_state_delta` | `{ "deltas": Array<object>, "model_route"?: string }` | 世界/关系状态变化 |
| `beat_ready` | `{ "beat_id": string, "beat_summary": string }` | 当前 beat 结束，等待用户决策 |
| `complete` | `{ "message": string }` | 全部 beat 结束 |
| `error` | `{ "message": string }` | 脱敏错误 |

### 典型顺序

```text
status
outline
status
scene_change
agent_act
agent_think
agent_speak
world_state_delta
beat_ready
status: Waiting for player to continue...
...
complete
```

### 错误

| 状态 | 触发 |
|---|---|
| `404` | session 不存在 |
| `400` | session 没有 `task_prompt` |
| SSE `error` event | stream 期间内部异常，message 固定为脱敏文本 |

重要实现约束：

- stream 建立前只短暂读取 DB。
- stream 期间每个 event 前短暂检查 session status。
- Director 写 messages/dossiers 时也使用短生命周期 session。
- 不应把一个 request-level DB session 保持到整个 stream 完成。

## POST `/api/session/{session_id}/action`

给活跃 Story session 发送玩家动作。

Request schema：[backend/models/schemas.py](../../backend/models/schemas.py) `SessionAction`

```json
{
  "action": "continue",
  "redirect_prompt": null,
  "target_character": null
}
```

Actions：

| action | required field | 后端行为 |
|---|---|---|
| `continue` | none | `status=active`，如果有活跃 queue 则投递 `{"action":"continue"}` |
| `stop` | none | `status=paused` |
| `redirect` | `redirect_prompt` | 替换 `task_prompt`，投递 `{"action":"redirect","prompt":...}` |
| `switch_perspective` | `target_character` | 更新 `active_character_id`，投递 `{"action":"switch_perspective","target":...}` |

Response：

```json
{
  "status": "ok",
  "session_id": "uuid"
}
```

错误：

| 状态 | 条件 |
|---|---|
| `404` | session 不存在 |
| `400` | unknown action |
| `400` | redirect 缺少 `redirect_prompt` |
| `400` | switch_perspective 缺少 `target_character` |

## GET `/api/session/{session_id}/messages`

返回某个 Story session 已持久化的 assistant messages，供页面刷新恢复。

Query：

| 参数 | 默认 | 规则 |
|---|---|---|
| `limit` | `500` | 必须 `>=1`，后端强制 cap 到 500 |
| `offset` | `0` | 必须 `>=0` |

Response：

```json
[
  {
    "id": "uuid",
    "session_id": "uuid",
    "role": "assistant",
    "content": "We need to talk.",
    "character_name": "Walter White",
    "emotion_state": "tense",
    "gif_search_query": "walter white nervous serious",
    "beat_id": "beat_1",
    "created_at": "2026-07-01T00:00:00"
  }
]
```

注意：

- 只有 Story 模式的 `agent_speak` 会写入 `messages` 表。
- 该 endpoint 不返回 `agent_think`、`agent_act`、`scene_change`。
- 返回顺序是 oldest-first：`created_at asc, id asc`。
- session existence check 只 select primary key，避免触发 ORM selectin 关系加载。

## POST `/api/chat`

普通 Chat view 的统一聊天 endpoint，支持 direct 和 crew。

Request：

```json
{
  "characterId": "walter",
  "userInput": "What are you hiding?",
  "relation": "former student",
  "mode": "direct",
  "history": [
    { "sender": "user", "text": "..." },
    { "sender": "walter", "text": "..." }
  ],
  "language": "zh",
  "llmProvider": "cliproxy",
  "voiceExample": "Choose your words carefully..."
}
```

Schema：`ChatRequest` in [backend/api/routes.py](../../backend/api/routes.py)

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `characterId` | string | required | 前端角色短 id |
| `userInput` | string | required | 用户消息；空字符串返回 400 |
| `relation` | string | `partner` | 关系锚点 |
| `mode` | string | `direct` | `direct` 或 `crew` |
| `history` | array | `[]` | 最近聊天历史 |
| `language` | string | `en` | 目标语言 |
| `llmProvider` | string | `stepfun` | 后端识别 `minimax` / `stepfun` / 其他走 CLIProxy |
| `voiceExample` | string/null | `null` | 风格参考文本 |

当前前端还会发送 `memorySummary` 和 `keyFacts`，但 FastAPI schema 未声明这些字段，当前后端不会使用。

### Direct response

```json
{
  "reply_text": "I am not hiding anything from you.",
  "emotion_state": "tense",
  "gif_search_query": "walter white tense stare",
  "thinking": "If they keep pressing, this becomes a liability.",
  "tool_executed": null,
  "tool_log": null,
  "updated_relationship_state": null
}
```

### Crew response

```json
{
  "participants": ["walter", "saul"],
  "scene_goal": "Crew debate: What are we doing about Gus?",
  "tension_note": "walter, saul debating.",
  "debate_logs": [
    {
      "sender": "walter",
      "text": "...",
      "emotion": "tense",
      "gifQuery": "walter white angry determined",
      "thinking": "...",
      "tool_executed": null,
      "tool_log": null
    }
  ]
}
```

错误：

| 状态 | 条件 |
|---|---|
| `400` | `userInput` 为空 |
| `400` | `mode` 不是 `direct` / `crew` |
| `500` | 内部错误，detail 固定 `"Internal server error."` |

## Pydantic/SSE Schema 文件

主要 schema 文件：[backend/models/schemas.py](../../backend/models/schemas.py)

| 类 | 用途 |
|---|---|
| `SessionCreate` | `/session/create` request |
| `SessionAction` | `/session/{id}/action` request |
| `SessionActionResponse` | action response |
| `SessionResponse` | create session response |
| `MessageResponse` | message response model，当前 routes 内另有 `MessageOut` |
| `AgentEvent` | SSE envelope |
| `SceneChangeData` | typed `scene_change.data` |
| `AgentActData` | typed `agent_act.data` |
| `AgentSpeakData` | typed `agent_speak.data` |
| `AgentThinkData` | typed `agent_think.data` |
| `WorldStateDeltaData` | typed `world_state_delta.data` |
| `BeatReadyData` | typed `beat_ready.data` |
| `CharacterStateResponse` | 预留角色状态 response |

## Legacy Serverless API

这些文件存在于根目录 [api](../../api)，用于 Vercel serverless 风格部署或旧 Demo 兼容。当前 React 前端主路径不依赖它们。

### [api/chat.py](../../api/chat.py)

- `BaseHTTPRequestHandler` 实现的 `/api/chat`。
- 自己处理 LLM provider config。
- 默认 provider 语义与 FastAPI 不完全相同。
- 不使用 FastAPI lifespan、SQLAlchemy、DirectorAgent 单例。

### [api/story.py](../../api/story.py)

- `POST /api/story`。
- 一次性生成 outline 和完整 beats。
- 适合旧的本地回放模式，不是当前 `useStoryStream` 路径。

维护建议：

- 如果继续以 FastAPI + Docker 为主，可以把 legacy endpoint 视为兼容层，不要在新功能中优先扩展。
- 如果要删除 legacy，需要同步检查 Vercel 配置和 README 中旧 API 描述。
