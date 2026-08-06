# API 参考

## 基础信息

- **Base URL**: 开发环境 `http://localhost:8001/api`，生产环境 `https://bb.yishuziyu.cn/api`
- **格式**: JSON
- **SSE 流**: `text/event-stream`
- **认证**: 无 (免费额度 + IP 限流) 或 Supabase Auth (JWT)

## 端点列表

### 健康检查

```
GET /api/health
```

**响应**: `{ "status": "ok", "version": "0.1.0" }`

### BYOK 连接管理

```
POST /api/byok/connect
```
**请求体**: `{ "provider": "openai", "api_key": "sk-..." }`
**响应**: `{ "status": "connected", "provider": "openai" }`

```
POST /api/byok/disconnect
```
**请求体**: `{ "provider": "openai" }`
**响应**: `{ "status": "disconnected" }`

```
GET /api/byok/status
```
**响应**: `{ "connections": [...] }`

### 配额查询

```
GET /api/quota?guest_id=<uuid>
```
**响应**: `{ "remaining": 42, "total": 80, "reset_at": "2026-07-31T00:00:00Z" }`

### 文字转语音

```
POST /api/tts
```
**请求体**: `{ "text": "Hello", "character_id": "walter", "language": "en" }`
**响应**: `audio/mpeg` 二进制流

### 会话管理

```
POST /api/sessions
```
**请求体**: `SessionCreate` (title, task_prompt, active_character_id?, language?)
**响应**: `SessionResponse` (session_id, title, status, created_at)

```
GET /api/sessions/{id}
```
**响应**: `SessionResponse`

```
GET /api/sessions/{id}/messages
```
**响应**: `[MessageResponse, ...]`

```
POST /api/sessions/{id}/action
```
**请求体**: `SessionAction` (action, redirect_prompt?, target_character?, branch_goal?, ...)
**响应**: `SessionActionResponse` (status, session_id)

### 对话 (Direct / Crew)

```
POST /api/chat
```
**请求体**:
```json
{
  "session_id": "uuid",
  "userInput": "Hello, Walter",
  "mode": "direct",
  "character_id": "walter",
  "language": "en",
  "participants": []  // crew 模式时指定参与角色
}
```
**响应**:
```json
{
  "reply_text": "...",
  "emotion_state": "calm",
  "gif_search_query": "walter white",
  "thinking": "...",
  "character_id": "walter",
  "character_name": "Walter"
}
```

### 故事模式

```
POST /api/story/start
```
**请求体**:
```json
{
  "session_id": "uuid",
  "task_prompt": "A meeting at Los Pollos Hermanos...",
  "active_character_id": "gus",
  "language": "en"
}
```
**响应**: `{ "session_id": "uuid", "status": "started" }`

```
GET /api/story/stream?session_id=<uuid>
```
**SSE 事件流** — 持续推送事件直到故事完成。

## SSE 事件类型

故事模式使用 `text/event-stream` 协议，每个事件格式为:

```
event: <event_type>
data: <JSON>
```

### 事件类型清单

| 事件类型 | data 结构 | 说明 |
|---------|-----------|------|
| `status` | `{ "message": "..." }` | 状态更新 (分析中、生成中) |
| `outline` | `{ "outline_text": "...", "num_beats": N }` | 故事大纲已生成 |
| `scene_change` | `{ "from_scene": "...", "to_scene": "...", "description": "..." }` | 场景切换 |
| `agent_act` | `{ "character_id": "...", "action": "...", "target": "..." }` | 角色物理动作 |
| `agent_speak` | `{ "character_id": "...", "content": "...", "emotion_state": "...", "gif_search_query": "..." }` | 角色说话 |
| `agent_think` | `{ "character_id": "...", "thinking": "...", "emotion_state": "..." }` | 角色内心独白 |
| `beat_ready` | `{ "beat_index": N, "scene": "...", "summary": "...", "beat_role": "..." }` | 节拍完成 |
| `dossier_update` | `{ "deltas": [...] }` | 角色档案更新 |
| `done` | `{ "session_id": "..." }` | 故事完成 |
| `error` | `{ "message": "..." }` | 错误 |

### SSE 事件流示例

```
event: status
data: {"message": "Analyzing your request..."}

event: outline
data: {"outline_text": "Beat 1: Inciting Incident...", "num_beats": 5}

event: scene_change
data: {"from_scene": "neutral", "to_scene": "los-pollos", "description": "Gus's restaurant"}

event: agent_speak
data: {"character_id": "gus", "content": "Good evening.", "emotion_state": "calm", "gif_search_query": "gus fring calm business"}

event: beat_ready
data: {"beat_index": 1, "scene": "los-pollos", "summary": "Gus greets the visitor", "beat_role": "inciting_incident"}

event: done
data: {"session_id": "abc-123"}
```

## 错误码

| 状态码 | 说明 |
|--------|------|
| 400 | 请求参数错误 (如 userInput 为空) |
| 404 | 资源不存在 (会话、角色) |
| 429 | 速率限制 (每 IP 每小时超限) |
| 500 | 服务器内部错误 |
| 502 | LLM 提供商调用失败 |
| 503 | 服务不可用 (API key 未配置) |