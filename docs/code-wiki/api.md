# API 接口说明

## 1. REST 端点

文件：`[backend/api/routes.py](../../backend/api/routes.py)`

### 1.1 健康检查

```http
GET /api/health
```

响应：

```json
{
  "status": "ok",
  "service": "breaking-bad-roleplay"
}
```

### 1.2 创建剧情 Session

```http
POST /api/session/create
Content-Type: application/json

{
  "title": "string",
  "task_prompt": "string",
  "active_character_id": "walter"
}
```

响应：`SessionResponse`

```json
{
  "session_id": "uuid",
  "title": "string",
  "status": "active",
  "created_at": "2026-06-27T00:00:00"
}
```

### 1.3 玩家动作

```http
POST /api/session/{session_id}/action
Content-Type: application/json

{
  "action": "continue" | "stop" | "redirect" | "switch_perspective",
  "redirect_prompt": "string",
  "target_character": "walter"
}
```

响应：`SessionActionResponse`

```json
{
  "status": "ok",
  "session_id": "uuid"
}
```

说明：

- `continue`：向该 session 的 action_queue 发送信号，继续下一 beat。
- `stop`：将 session 状态设为 `paused`。
- `redirect`：替换 `task_prompt`，需传 `redirect_prompt`。
- `switch_perspective`：切换 `active_character_id`，需传 `target_character`。

### 1.4 SSE 剧情流

```http
GET /api/session/{session_id}/stream
```

返回 `text/event-stream`。

### 1.5 聊天

```http
POST /api/chat
Content-Type: application/json

{
  "characterId": "walter",
  "userInput": "string",
  "relation": "partner",
  "mode": "direct" | "crew",
  "history": [{"sender": "user", "text": "..."}],
  "language": "en" | "zh",
  "llmProvider": "stepfun",
  "voiceExample": "string"
}
```

Direct 响应：

```json
{
  "reply_text": "...",
  "emotion_state": "tense",
  "gif_search_query": "walter white tense",
  "thinking": "...",
  "tool_executed": null,
  "tool_log": null,
  "updated_relationship_state": null
}
```

Crew 响应：

```json
{
  "participants": ["walter", "jesse"],
  "scene_goal": "Crew debate: ...",
  "tension_note": "walter, jesse debating.",
  "debate_logs": [
    {
      "sender": "walter",
      "text": "...",
      "emotion": "tense",
      "gifQuery": "...",
      "thinking": "...",
      "tool_executed": null,
      "tool_log": null
    }
  ]
}
```

## 2. SSE 事件协议

### 2.1 事件格式

```
event: {type}
data: {json}

```

### 2.2 事件类型

| 事件类型 | 触发时机 | 示例 data |
|----------|----------|-----------|
| `status` | 流程状态变化 | `{ "message": "Director is analysing the task…" }` |
| `outline` | 大纲生成完成 | `{ "content": "1. RV in the desert — ..." }` |
| `scene_change` | 场景切换 | `{ "from_scene": "...", "to_scene": "...", "description": "..." }` |
| `agent_act` | 角色动作 | `{ "character_id": "Walter White", "action": "sits down", "target": null }` |
| `agent_think` | 角色内心独白 | `{ "character_id": "Walter White", "thought_content": "..." }` |
| `agent_speak` | 角色台词 | `{ "character_id": "Walter White", "content": "...", "emotion_state": "tense", "gif_search_query": "..." }` |
| `world_state_delta` | 世界状态变化 | `{ "deltas": [{ "target": "...", "field": "...", "old_value": "...", "new_value": "..." }] }` |
| `beat_ready` | 当前 beat 完成，等待玩家决策 | `{ "beat_id": "beat_1", "beat_summary": "..." }` |
| `complete` | 所有 beat 渲染完成 | `{ "message": "All beats rendered." }` |
| `error` | 错误 | `{ "message": "..." }` |

## 3. 遗留 Serverless 端点

项目根目录保留两个 Vercel serverless 函数作为兼容层：

- `[api/chat.py](../../api/chat.py)`：直接调用 LLM，无 FastAPI/SQLAlchemy 依赖。
- `[api/story.py](../../api/story.py)`：单次调用返回大纲与完整 beats，供前端本地回放。

当前前端 `useStoryStream` 调用的是 `/api/story`（serverless 版本），而聊天调用 `/api/chat`（FastAPI 版本）。
