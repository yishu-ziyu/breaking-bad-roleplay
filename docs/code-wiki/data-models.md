# 数据模型与 Schema

## 1. 数据库模型（SQLAlchemy）

文件：`[backend/db/models.py](../../backend/db/models.py)`

### 1.1 Session

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String(36), PK | UUID |
| `title` | String(200) | session 标题 |
| `status` | String(20) | `active` / `paused` / `completed` |
| `current_mode` | String(20) | `global` / `in-character` |
| `active_character_id` | String(50), nullable | 在场视角下玩家扮演的角色 |
| `task_prompt` | Text, nullable | 玩家原始任务 |
| `plot_outline` | Text, nullable | Director 生成的大纲 |
| `created_at` / `updated_at` | DateTime | 时间戳 |

关系：

- `messages`: 一对多 `Message`
- `character_states`: 一对多 `CharacterState`
- `character_dossiers`: 一对多 `CharacterDossier`

### 1.2 Message

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String(36), PK | UUID |
| `session_id` | String(36), FK → sessions.id | 所属 session |
| `role` | String(20) | `user` / `assistant` / 角色名 |
| `content` | Text | 消息内容 |
| `character_name` | String(50), nullable | 角色名 |
| `emotion_state` | String(50), nullable | 情绪标签 |
| `gif_search_query` | String(200), nullable | GIF 搜索词 |
| `beat_id` | String(36), nullable | 所属 beat |
| `created_at` | DateTime | 时间戳 |

### 1.3 CharacterState

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String(36), PK | UUID |
| `session_id` | String(36), FK, nullable | `null` 表示世界级 |
| `character_id` | String(50) | 角色 ID |
| `current_emotion` | String(50), nullable | 当前情绪 |
| `location` | String(100), nullable | 位置 |
| `status` | String(100), nullable | 状态 |
| `updated_at` | DateTime | 时间戳 |

### 1.4 CharacterDossier

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String(36), PK | UUID |
| `session_id` | String(36), FK, nullable | `null` 表示世界级 |
| `owner_id` | String(50) | 持有该档案的角色 |
| `subject_id` | String(50) | 档案描述的对象角色 |
| `trust_level` | int | 信任度 1-10 |
| `knowledge` | Text, JSON | 已知情报 |
| `relationship_notes` | Text | 关系备注 |
| `updated_at` | DateTime | 时间戳 |

### 1.5 数据库迁移

文件：`[supabase/migrations/20260626120000_create_tables.sql](../../supabase/migrations/20260626120000_create_tables.sql)`

MVP 阶段使用 `Base.metadata.create_all()` 自动建表，生产环境建议迁移到 Alembic。

## 2. Pydantic Schema

文件：`[backend/models/schemas.py](../../backend/models/schemas.py)`

### 2.1 请求模型

| 模型 | 字段 | 说明 |
|------|------|------|
| `SessionCreate` | `title`, `task_prompt`, `active_character_id` | 创建 session |
| `SessionAction` | `action`, `redirect_prompt`, `target_character` | 玩家动作 |

### 2.2 响应模型

| 模型 | 字段 | 说明 |
|------|------|------|
| `SessionResponse` | `session_id`, `title`, `status`, `created_at` | 创建 session 响应 |
| `SessionActionResponse` | `status`, `session_id` | 动作响应 |
| `MessageResponse` | `id`, `session_id`, `role`, `content`, `character_name`, `created_at` | 消息响应 |

### 2.3 SSE 事件模型

| 模型 | type | data 字段 |
|------|------|-----------|
| `AgentEvent` | 任意 | `type`, `data`, `model_route` |
| `SceneChangeData` | `scene_change` | `from_scene`, `to_scene`, `description` |
| `AgentActData` | `agent_act` | `character_id`, `action`, `target` |
| `AgentSpeakData` | `agent_speak` | `character_id`, `content`, `emotion_state`, `gif_search_query` |
| `AgentThinkData` | `agent_think` | `character_id`, `thought_content` |
| `WorldStateDeltaData` | `world_state_delta` | `deltas` 数组 |
| `BeatReadyData` | `beat_ready` | `beat_id`, `beat_summary` |

事件类型映射：`EVENT_DATA_MODELS`。

## 3. 角色 ID 映射

| 前端 ID | 后端 ID |
|---------|---------|
| `walter` | `Walter White` |
| `jesse` | `Jesse Pinkman` |
| `skyler` | `Skyler White` |
| `saul` | `Saul Goodman` |
| `mike` | `Mike Ehrmantraut` |
| `gus` | `Gus Fring` |

定义在 `[backend/agents/director.py](../../backend/agents/director.py)`。
