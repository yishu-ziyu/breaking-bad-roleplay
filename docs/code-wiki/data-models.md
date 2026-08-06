# 数据模型

## 1. SQLAlchemy ORM 模型 (PostgreSQL)

所有模型定义在 [backend/db/models.py](file:///Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay/backend/db/models.py)。

### `Session` — 会话表

```python
class Session(Base):
    __tablename__ = "sessions"
    id: str (PK, UUID)           # 主键
    title: str                   # 会话标题
    status: str                  # 状态: active / completed / archived
    current_mode: str             # 当前模式: story / direct / crew
    active_character_id: str?    # 当前活跃角色 ID
    task_prompt: str?             # 用户输入的任务提示
    plot_outline: str?            # 剧情大纲文本
    next_beat_index: int          # 下一个节拍索引 (default 0)
    created_at: datetime          # 创建时间
    updated_at: datetime          # 更新时间

    # 关系
    messages: list[Message]       # 会话消息
    character_states: list[CharacterState]  # 角色状态
    dossiers: list[CharacterDossier]        # 角色档案
```

### `Message` — 消息表

```python
class Message(Base):
    __tablename__ = "messages"
    id: str (PK, UUID)           # 主键
    session_id: str (FK)         # 关联会话
    role: str                    # 角色: user / assistant / system / character
    content: str                 # 消息内容
    character_name: str?         # 角色名 (assistant/character 类型)
    character_id: str?           # 角色 ID
    emotion_state: str?          # 情感状态
    gif_search_query: str?       # GIF 搜索词
    thinking: str?               # 内心独白
    beat_index: int?             # 所属节拍索引
    model_route: str?            # 使用的模型路由
    created_at: datetime

    # 关系
    session: Session             # 所属会话
```

### `CharacterState` — 角色状态表

```python
class CharacterState(Base):
    __tablename__ = "character_states"
    id: str (PK, UUID)
    session_id: str (FK)         # 关联会话
    character_id: str            # 角色 ID
    trust: int = 0               # 信任度
    suspicion: int = 1           # 怀疑度
    pressure: int = 1            # 压力值
    closeness: int = 0           # 亲密值
    threat: int = 0              # 威胁值
    updated_at: datetime

    # 关系
    session: Session
```

### `CharacterDossier` — 角色档案表 (双层记忆)

```python
class CharacterDossier(Base):
    __tablename__ = "character_dossiers"
    id: str (PK, UUID)
    session_id: str? (FK)        # NULL = world-level, 非 NULL = session-level
    owner_id: str                # 感知方角色 ID
    subject_id: str              # 被感知方角色 ID
    trust_level: int = 5         # 信任等级 (1-10)
    knowledge: str (JSON)        # 知识条目 (JSON dict, keyed by timestamp)
    relationship_notes: str      # 关系笔记 (running log)
    created_at: datetime
    updated_at: datetime

    # 关系
    session: Session?
```

### 数据库关系图

```
sessions
    │
    ├── messages (1:N)
    │     └── session_id → sessions.id
    │
    ├── character_states (1:N)
    │     └── session_id → sessions.id
    │
    └── character_dossiers (1:N)
          └── session_id → sessions.id  (nullable, NULL = world-level)
```

## 2. Pydantic Schema 模型 (API 层)

所有 Schema 定义在 [backend/models/schemas.py](file:///Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay/backend/models/schemas.py)。

### 请求 Schema

```python
class SessionCreate(BaseModel):
    title: str
    task_prompt: str
    active_character_id: str | None = None
    language: str = "en"

class SessionAction(BaseModel):
    action: str                   # continue | stop | redirect | switch_perspective | continue_chapter | branch | replay
    redirect_prompt: str | None = None
    target_character: str | None = None
    from_beat_id: str | None = None
    branch_goal: str | None = None
    beat_id: str | None = None
```

### 响应 Schema

```python
class SessionResponse(BaseModel):
    session_id: str
    title: str
    status: str
    created_at: datetime

class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    character_name: str | None
    created_at: datetime
```

### SSE 事件 Schema

```python
class AgentEvent(BaseModel):
    type: str                     # 事件类型
    data: dict[str, Any]         # 事件数据
    model_route: str | None = None

class SceneChangeData(BaseModel):
    from_scene: str
    to_scene: str
    description: str

class AgentSpeakData(BaseModel):
    character_id: str
    content: str
    emotion_state: str
    gif_search_query: str

class AgentThinkData(BaseModel):
    character_id: str
    thinking: str
    emotion_state: str

class BeatReadyData(BaseModel):
    beat_index: int
    scene: str
    summary: str
    beat_role: str
```

## 3. 前端类型定义

### 角色类型 (`roleProfiles.ts`)

```typescript
type CharacterId = 'walter' | 'jesse' | 'skyler' | 'saul' | 'mike' | 'gus' | 'hank' | 'marie'

type RelationshipState = {
  trust: number
  suspicion: number
  pressure: number
  closeness: number
  threat: number
}

type RoleProfile = {
  roleKernel: string[]
  voiceRules: string[]
  relationshipRules: Record<string, string[]>
  emotionTags: string[]
  visualTags: string[]
  acceptanceChecks: string[]
}
```

### GIF 资产类型 (`roleAssets.ts`)

```typescript
type RoleGifTag = 'default' | 'tense' | 'chemistry' | 'panic' | 'lawyer'
                | 'glare' | 'money' | 'desert' | 'family' | 'deal'
                | 'business' | 'restraint' | 'confrontation'

type RoleGifAsset = {
  id: string
  source: 'giphy'
  url: string
  tags: RoleGifTag[]
  usageNotes: string
  safetyNotes: string
  copyrightNotes: string
}
```

## 4. 配置模型 (`config.py`)

Pydantic `Settings` 类，从 `.env` 加载。关键字段见 [backend.md](backend.md) 第 2 节。