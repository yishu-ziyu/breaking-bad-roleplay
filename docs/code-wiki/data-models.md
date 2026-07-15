# Data Models

本项目目前有三类持久化/状态模型：

1. 后端 PostgreSQL + SQLAlchemy：Story session、SSE dialogue、character dossiers。
2. Supabase：前端 auth、普通 Chat view 的云同步消息和角色记忆。
3. localStorage：前端 UI 状态、普通聊天本地副本、Story saved session id、GIF cooldown。

这三类模型不要混用。Story 主路径依赖后端 SQLAlchemy 表；普通聊天云同步依赖 Supabase 表。

## 后端 ORM：[backend/db/models.py](../../backend/db/models.py)

### `Session`

表名：`sessions`

| 字段 | 类型 | nullable | 说明 |
|---|---|---|---|
| `id` | `String(36)` | no | UUID primary key |
| `title` | `String(200)` | no | session 标题 |
| `status` | `String(20)` | no | `active` / `paused` / `stopped` 等 |
| `current_mode` | `String(20)` | no | 当前默认 `story` |
| `active_character_id` | `String(50)` | yes | 当前主视角角色，通常是前端短 id |
| `task_prompt` | `Text` | yes | Director 任务 |
| `plot_outline` | `Text` | yes | 预留 outline 存储 |
| `created_at` | `DateTime` | no | naive UTC |
| `updated_at` | `DateTime` | no | naive UTC，onupdate |

Relationships：

| relationship | target | 说明 |
|---|---|---|
| `messages` | `Message[]` | `cascade="all, delete-orphan"`, `lazy="selectin"` |
| `character_states` | `CharacterState[]` | `cascade="all, delete-orphan"`, `lazy="selectin"` |
| `character_dossiers` | `CharacterDossier[]` | `cascade="all, delete-orphan"`, `lazy="selectin"` |

### `Message`

表名：`messages`

| 字段 | 类型 | nullable | 说明 |
|---|---|---|---|
| `id` | `String(36)` | no | UUID primary key |
| `session_id` | `String(36)` | no | FK -> `sessions.id`, cascade delete, indexed |
| `role` | `String(20)` | no | 当前 Story 写入 `assistant` |
| `content` | `Text` | no | 角色台词 |
| `character_name` | `String(50)` | yes | 后端完整角色名，如 `Walter White` |
| `emotion_state` | `String(50)` | yes | 情绪标签 |
| `gif_search_query` | `String(200)` | yes | 英文视觉 query |
| `beat_id` | `String(36)` | yes | 如 `beat_1` |
| `created_at` | `DateTime` | no | naive UTC |

用途：

- 只持久化 Story 的 `agent_speak` 事件。
- `GET /api/session/{id}/messages` 从这里恢复页面刷新前的 dialogue。

### `CharacterState`

表名：`character_states`

| 字段 | 类型 | nullable | 说明 |
|---|---|---|---|
| `id` | `String(36)` | no | UUID primary key |
| `session_id` | `String(36)` | yes | FK -> `sessions.id`，允许为空 |
| `character_id` | `String(50)` | no | 角色 id |
| `current_emotion` | `String(50)` | yes | 当前情绪 |
| `location` | `String(100)` | yes | 当前地点 |
| `status` | `String(100)` | yes | 状态文本 |
| `updated_at` | `DateTime` | no | naive UTC |

当前用途：

- 模型已存在，Story 主流程主要写 `messages` 和 `character_dossiers`；`character_states` 更像后续世界状态扩展点。

### `CharacterDossier`

表名：`character_dossiers`

| 字段 | 类型 | nullable | 说明 |
|---|---|---|---|
| `id` | `String(36)` | no | UUID primary key |
| `session_id` | `String(36)` | yes | `NULL` 表示 world-level dossier |
| `owner_id` | `String(50)` | no | 感知主体，如 `walter_white` |
| `subject_id` | `String(50)` | no | 被感知对象 |
| `trust_level` | `int` | no | 1-10，默认 5 |
| `knowledge` | `Text` | no | JSON string，默认 `{}` |
| `relationship_notes` | `Text` | no | 关系备注，默认空字符串 |
| `updated_at` | `DateTime` | no | naive UTC |

语义：

- `session_id IS NULL`：跨 session 世界记忆。
- `session_id = 当前 session`：当前 playthrough 内记忆。
- `knowledge` 由 `_apply_dossier_delta` 保留最近 50 条。
- `relationship_notes` 保留最近 2000 字符。

## 后端 Pydantic Models

文件：[backend/models/schemas.py](../../backend/models/schemas.py)

### Session / message schema

| 类 | 字段 |
|---|---|
| `SessionCreate` | `title`, `task_prompt`, `active_character_id?` |
| `SessionAction` | `action`, `redirect_prompt?`, `target_character?` |
| `SessionActionResponse` | `status`, `session_id` |
| `SessionResponse` | `session_id`, `title`, `status`, `created_at` |
| `MessageResponse` | `id`, `session_id`, `role`, `content`, `character_name?`, `created_at` |
| `CharacterStateResponse` | `id`, `session_id`, `character_name`, `state`, `updated_at` |

`routes.py` 内还定义了 `MessageOut`，字段比 `MessageResponse` 更完整：

```text
id, session_id, role, content, character_name,
emotion_state, gif_search_query, beat_id, created_at
```

### SSE envelope

```python
class AgentEvent(BaseModel):
    type: str
    data: dict[str, Any]
    model_route: Optional[str] = None
```

Typed event data：

| Event | Model | 字段 |
|---|---|---|
| `scene_change` | `SceneChangeData` | `from_scene`, `to_scene`, `description` |
| `agent_act` | `AgentActData` | `character_id`, `action`, `target?` |
| `agent_speak` | `AgentSpeakData` | `character_id`, `content`, `emotion_state`, `gif_search_query` |
| `agent_think` | `AgentThinkData` | `character_id`, `thought_content` |
| `world_state_delta` | `WorldStateDeltaData` | `deltas` |
| `beat_ready` | `BeatReadyData` | `beat_id`, `beat_summary` |

## Alembic Migrations

路径：[backend/alembic/versions](../../backend/alembic/versions)

| revision | 文件 | 作用 |
|---|---|---|
| `f1a2b3c4d5e6` | `f1a2b3c4d5e6_initial_schema.py` | 创建 `sessions`、`messages`、`character_states`、`character_dossiers` |
| `e5f6a7b8c9d0` | `e5f6a7b8c9d0_fix_nullable_columns.py` | 修正 `character_dossiers.trust_level/knowledge/relationship_notes` 非空和 server defaults |

### 当前迁移风险

当前 ORM 的 `Session` 模型包含：

```python
current_mode = mapped_column(String(20), default="story", nullable=False)
```

但初始 Alembic migration 的 `sessions` 建表语句没有 `current_mode` 字段。后续开发前应补一条 migration：

```text
add sessions.current_mode varchar(20) not null default 'story'
```

否则干净数据库通过 `alembic upgrade head` 后，`POST /api/session/create` 可能因为 ORM 写入不存在列而失败。

### Schema 管理原则

- 正式路径：`alembic upgrade head`。
- 不要依赖 app startup `create_all`，`backend/main.py` 已明确移除。
- [backend/scripts/setup_db.py](../../backend/scripts/setup_db.py) 仍存在 `Base.metadata.create_all`，更适合作为旧本地应急脚本，不应作为长期 schema 变更方式。

## Supabase Schema

迁移文件：[supabase/migrations/20260626120000_create_tables.sql](../../supabase/migrations/20260626120000_create_tables.sql)

### `chat_messages`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | primary key |
| `user_id` | UUID | FK -> `auth.users(id)` |
| `character_id` | TEXT | 前端角色短 id |
| `message` | TEXT | 新写入为 `abqenc:v1:` 客户端加密 envelope；旧数据可能是明文 |
| `sender` | TEXT | `user` 或角色短 id |
| `emotion` | TEXT | 情绪 |
| `created_at` | TIMESTAMPTZ | 创建时间 |

索引：

```sql
CREATE INDEX idx_chat_messages_user_char
ON chat_messages(user_id, character_id, created_at);
```

### `character_memory`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | primary key |
| `user_id` | UUID | FK -> `auth.users(id)` |
| `character_id` | TEXT | 前端角色短 id |
| `summary` | TEXT | 新写入为 `abqenc:v1:` 客户端加密 envelope；旧数据可能是明文 |
| `key_facts` | JSONB | 新写入为加密 envelope wrapper；旧数据可能是 key facts array |
| `updated_at` | TIMESTAMPTZ | 更新时间 |

约束：

```sql
UNIQUE(user_id, character_id)
```

### `story_sessions`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | primary key |
| `user_id` | UUID | FK -> `auth.users(id)` |
| `task_prompt` | TEXT | 任务 |
| `outline` | TEXT | outline |
| `beats` | JSONB | beats |
| `current_beat` | INT | 当前 beat |
| `confirmed` | BOOLEAN | 是否确认 |
| `created_at` | TIMESTAMPTZ | 创建时间 |

当前状态：

- 这是 Supabase 侧旧/预留 story 表。
- 当前 React Story 主路径使用 FastAPI `/api/session/create` 和后端 `sessions/messages/character_dossiers`，没有直接写 Supabase `story_sessions`。

### RLS

三张 Supabase 表都启用 RLS：

```sql
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_sessions ENABLE ROW LEVEL SECURITY;
```

策略都是用户只能管理自己的行：

```sql
auth.uid() = user_id
```

### 云端隐私加密

RLS 只隔离普通用户，不能阻止持有 service role / 数据库管理员权限的人读取明文。因此前端云同步还会通过 [src/lib/privacyVault.ts](../../src/lib/privacyVault.ts) 做客户端加密：

- 登录/注册时由用户密码派生 AES-GCM 隐私密钥。
- 新的 `chat_messages.message`、`character_memory.summary`、`character_memory.key_facts` 写入 Supabase 前会加密。
- 读取时自动解密 `abqenc:v1:` envelope，旧明文数据保留兼容。
- 如果用户已有 session 但本机没有隐私密钥，云同步进入 `privacy-locked`，不会继续上传明文。

完整边界见 [docs/PRIVACY_MODEL.md](../PRIVACY_MODEL.md)。

## Frontend Types

### [src/roleProfiles.ts](../../src/roleProfiles.ts)

核心类型：

```ts
export type CharacterId = 'walter' | 'jesse' | 'skyler' | 'saul' | 'mike' | 'gus' | 'hank'

export type RelationshipState = {
  trust: number
  suspicion: number
  pressure: number
  closeness: number
  threat: number
}

export type RoleProfile = {
  roleKernel: string[]
  voiceRules: string[]
  relationshipRules: Record<string, string[]>
  emotionTags: string[]
  visualTags: string[]
  acceptanceChecks: string[]
}
```

### [src/roleAssets.ts](../../src/roleAssets.ts)

核心类型：

```ts
export type RoleGifTag =
  | 'default'
  | 'tense'
  | 'chemistry'
  | 'panic'
  | 'lawyer'
  | 'glare'
  | 'money'
  | 'desert'
  | 'family'
  | 'deal'
  | 'business'
  | 'restraint'
  | 'confrontation'
```

`roleAssets` 是前端 GIF registry，`gifResolver` 基于 tag 选择 URL。

### `StoryEvent`

文件：[src/hooks/useStoryStream.ts](../../src/hooks/useStoryStream.ts)

```ts
export interface StoryEvent {
  type: string
  data: Record<string, unknown>
  received_at?: number
}
```

前端没有为每种 SSE event 建独立 TypeScript union，渲染时按 `evt.type` 分支读取字段。

## localStorage Keys

| key | 来源 | 内容 |
|---|---|---|
| `abq_character` | `usePersistedState('character')` | 当前角色短 id |
| `abq_language` | `usePersistedState('language')` | `en` / `zh` |
| `abq_relation` | `usePersistedState('relation')` | 每个角色关系锚点 |
| `abq_view` | `usePersistedState('view')` | `chat` / `story` |
| `abq_mode` | `usePersistedState('mode')` | `direct` / `crew` |
| `abq_llm-v2` | `usePersistedState('llm-v2')` | `cliproxy` / `minimax` 等 |
| `abq_messages` | `usePersistedState('messages')` | 普通聊天消息 |
| `abq_memory` | `usePersistedState('memory')` | 前端聊天记忆 |
| `abq_story_session_id` | `useStoryStream` | 当前/上次 Story session id |
| `abq_recent_gifs` | `gifResolver` | 每角色最近使用 GIF URL |

## Character ID Mapping

后端 Story/Chat 常需要前后端 id 转换。

| Frontend id | Backend id |
|---|---|
| `walter` | `Walter White` |
| `jesse` | `Jesse Pinkman` |
| `skyler` | `Skyler White` |
| `saul` | `Saul Goodman` |
| `mike` | `Mike Ehrmantraut` |
| `gus` | `Gus Fring` |
| `hank` | `Hank Schrader` |

转换定义在 [backend/agents/director.py](../../backend/agents/director.py)：

- `FRONTEND_TO_BACKEND_ID`
- `BACKEND_TO_FRONTEND_ID`

## 数据生命周期

### 普通 Chat

```text
localStorage abq_messages
  -> optional Supabase chat_messages when logged in
localStorage abq_memory
  -> optional Supabase character_memory when logged in
```

### Story

```text
POST /api/session/create
  -> sessions row
SSE agent_speak generated
  -> messages row
beat ends
  -> character_dossiers session-level + world-level
browser refresh
  -> localStorage abq_story_session_id
  -> GET /api/session/{id}/messages
```

## Model Evolution Checklist

修改数据模型时按这个顺序做：

1. 改 SQLAlchemy model 或 Supabase migration。
2. 后端 SQLAlchemy 模型变化必须新增 Alembic migration。
3. 更新 Pydantic schema / route response model。
4. 更新前端 TypeScript type 和 render 分支。
5. 更新测试 fixtures。
6. 更新本 Code Wiki。
7. 对干净数据库跑迁移并 smoke test。
