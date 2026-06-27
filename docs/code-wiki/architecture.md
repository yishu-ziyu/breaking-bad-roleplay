# 整体架构

## 1. 技术栈概览

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite |
| 前端状态 | 本地 `localStorage` + Supabase Auth/持久化 |
| 后端 | Python 3.11 + FastAPI + SQLAlchemy 2.0 (async) |
| 数据库 | PostgreSQL / Supabase |
| LLM 提供商 | MiniMax、StepFun、Agnes AI（ProviderFacade 统一封装）|
| 部署 | Docker + Railway / Fly.io / Render / Vercel |

## 2. 分层架构

```mermaid
flowchart TB
    subgraph Frontend["Frontend (React + Vite)"]
        A[App.tsx]
        H1[useAuth]
        H2[useStoryStream]
        H3[useCharacterMemory]
        C[AuthSection]
        S[Supabase Client]
    end

    subgraph Backend["Backend (FastAPI)"]
        R[api/routes.py]
        D[DirectorAgent]
        P[ProviderFacade]
        M[Memory Layer]
        DB[(PostgreSQL)]
        CA[Character Agents]
    end

    subgraph External["External Services"]
        LLM[LLM APIs]
        SUP[Supabase]
    end

    A -->|HTTP /api/chat| R
    A -->|HTTP /api/story| R
    A -->|SSE /api/session/{id}/stream| R
    R --> D
    D --> CA
    D --> P
    D --> M
    M --> DB
    P --> LLM
    S --> SUP
```

## 3. 核心模块职责

| 模块 | 职责 |
|------|------|
| `src/App.tsx` | 单页应用根组件，承载角色选择、聊天、剧情三大视图 |
| `src/hooks/useStoryStream.ts` | 剧情流状态管理：大纲确认、beat 回放、继续/停止动作 |
| `src/hooks/useAuth.ts` | Supabase 认证状态与登录/注册/登出 |
| `src/hooks/useCharacterMemory.ts` | 单角色记忆滑动窗口（摘要 + 关键事实） |
| `backend/main.py` | FastAPI 应用初始化、生命周期、CORS、静态文件 |
| `backend/api/routes.py` | REST 路由：健康检查、session 创建、action、SSE stream、聊天 |
| `backend/agents/director.py` | 导演 Agent：生成大纲、逐 beat 调度角色、产出 SSE 事件 |
| `backend/agents/provider.py` | 统一 LLM 调用门面，处理 MiniMax/StepFun/Agnes 协议差异 |
| `backend/agents/memory.py` | 双层记忆：session 内对话历史 + 跨 session 角色 dossiers |
| `backend/db/models.py` | SQLAlchemy ORM 模型：Session、Message、CharacterState、CharacterDossier |
| `backend/models/schemas.py` | Pydantic 请求/响应模型与 SSE 事件结构 |

## 4. 两种运行模式

### 4.1 聊天模式（Chat）

- **Direct**：玩家以特定关系与单个角色私聊。
- **Crew**：玩家发起话题，Director 调度 2-3 个角色进行辩论式对话。

入口：`POST /api/chat`（后端 FastAPI）或 `api/chat.py`（Vercel serverless 遗留）。

### 4.2 剧情模式（Story）

- 玩家输入自然语言任务。
- `DirectorAgent` 生成粗大纲（outline）。
- 每个 beat 依次渲染：scene_change → agent_act/think/speak → world_state_delta → beat_ready。
- 玩家在 beat_ready 时选择：继续 / 停止 / 改方向 / 切换视角。

入口：`POST /api/session/create` → `GET /api/session/{id}/stream`。

## 5. 数据流

### 5.1 聊天请求流

```
用户输入
  → App.tsx handleSend
  → POST /api/chat
  → DirectorAgent.handle_chat_message
  → BaseCharacter.respond_structured / _handle_crew_chat
  → ProviderFacade.call_model
  → 返回 JSON → 前端渲染消息
```

### 5.2 剧情请求流

```
用户输入任务
  → App.tsx handleStartStory
  → POST /api/session/create
  → GET /api/session/{id}/stream
  → DirectorAgent.process
  → _generate_outline → _generate_beat (per scene)
  → 角色 Sub-agent agent_speak
  → update_dossiers 更新记忆
  → SSE AgentEvent 推送到前端
```

## 6. 关键设计决策

| 决策 | 选择 | 说明 |
|------|------|------|
| 后端语言 | Python | 便于 LLM Agent 编排与 async 调用 |
| 持久化 | Postgres + SQLAlchemy async | 支持双层记忆与跨 session 状态 |
| LLM 协议 | ProviderFacade 统一 | 屏蔽 MiniMax/StepFun/OpenAI 协议差异 |
| 前端通信 | HTTP + SSE | 聊天用同步 HTTP，剧情用 SSE 实时流 |
| 角色实现 | 继承 BaseCharacter | 每个角色独立 system_prompt，便于扩展 |
| 部署 | 多平台配置 | Railway/Fly/Render/Vercel 各有独立配置文件 |
