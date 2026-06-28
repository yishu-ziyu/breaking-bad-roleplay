# ABQ Roleplay Lab — Architecture Design

> 本文档记录产品从「角色扮演聊天」升级为「Agent 自主剧情产品」的架构决策，是后续开发的锚点。  
> 最后更新：2026-06-16

---

## 1. Product Overview

ABQ Roleplay Lab 是一个《绝命毒师》世界观的 AI 角色扮演产品。玩家选择一个角色关系锚点后，与 Breaking Bad 角色进行对话。本轮重构的目标是：**从聊天驱动升级为 Agent 自主剧情驱动**，同时保留聊天板块。

### 1.1 核心循环

```
玩家写自然语言任务
  → Director Agent 拆解剧情 beat
  → 角色 Sub-agent 自主演绎
  → 每 beat 停下来等玩家决策
  → 玩家点「继续 / 阻止 / 改方向 / 切换角色视角」
  → Director 接收决策，继续下一 beat
```

### 1.2 两种镜头模式

- **全局视角** — 玩家像导演一样看完整剧情画面，Agent 调度所有角色
- **在场视角** — 玩家扮演某个角色，Agent 演绎其他角色，聊天直接参与剧情
- 两种模式自由切换，共享同一个世界状态

### 1.3 保留聊天板块

聊天内容和自主剧情共享上下文。玩家在聊天中透露的信息会潜移默化影响后续剧情走向。

---

## 2. Agent Architecture

### 2.1 整体分层

```
┌──────────────────────────────────────────────────┐
│  Frontend: React 19 + Vite                        │
│  ┌─────────────┐  ┌─────────────┐                 │
│  │ 剧情控制面板 │  │ 聊天板块    │                 │
│  └──────┬──────┘  └──────┬──────┘                 │
│         │ SSE             │ HTTP                   │
├─────────┼────────────────┼─────────────────────────┤
│  Python Backend: FastAPI                            │
│  ┌─────────────────────────────────────────────┐  │
│  │  Director Agent (主控)                       │  │
│  │  ┌────────┬────────┬────────┬────────┐      │  │
│  │  │ Walter │ Jesse  │ Skyler │ Saul   │ ... │  │  │
│  │  │ Agent  │ Agent  │ Agent  │ Agent  │     │  │  │
│  │  └────────┴────────┴────────┴────────┘      │  │
│  └─────────────────────────────────────────────┘  │
│         │                    │                      │
│  ┌──────┴──────┐    ┌───────┴──────────┐          │
│  │ Memory      │    │ Provider Facade  │          │
│  │ (Postgres)  │    │ (MiniMax / StepFun)│        │
│  └─────────────┘    └──────────────────┘          │
└──────────────────────────────────────────────────┘
```

### 2.2 Director Agent

职责：
1. 接收玩家的自然语言任务
2. 生成粗大纲（知道关键转折点，不锁死每一步）
3. 逐 beat 调度角色 Sub-agent 演出
4. 产出细粒度 SSE 事件流
5. 在 beat_ready 时同步更新角色 dossiers

执行模式：Plan-then-Emerge 混合。先生成大纲提供方向，每个 beat 演完后根据角色即兴反应动态决定下一 beat。

### 2.3 角色 Sub-agent（6 个）

| 角色 | 核心特质 | 工具能力 |
|------|----------|----------|
| Walter White | 骄傲、控制欲、科学逻辑 | 实验室压力模拟 |
| Jesse Pinkman | 冲动、情感驱动、忠诚 | — |
| Skyler White | 务实、怀疑、保护家庭 | — |
| Saul Goodman | 油滑、避险、话术 | 法律风险评估 |
| Mike Ehrmantraut | 冷静、专业、原则 | 安全态势读取 |
| Gus Fring | 精确、隐藏、长期主义 | 合规性评估 |

每个 Sub-agent 拥有：
- 独立的 voice profile（语气、用词习惯、标志性表达）
- 角色专属工具（function calling schema）
- 对共享世界状态的读写权限
- 对角色间 dossiers 的读取权限

### 2.4 子 Agent 委派

- Director 通过 sub-agent 机制，将每个 beat 的演出委托给对应的角色 Sub-agent
- 每个 Sub-agent 有隔离的上下文窗口（避免长对话污染）
- Sub-agent 的输出通过 Director 汇总后以 SSE 事件推送给前端

---

## 3. Data Layer

### 3.1 两层记忆

**Session 层**（每场剧情独立）
- 对话历史：每轮玩家消息和角色回复，全量保留
- 任务上下文：当前任务目标、玩家决策历史、beat 执行记录
- Session 结束后归档，不删除

**世界层**（跨 session 持久化）
- 角色 dossiers：角色间的关系、信任度、已知情报、彼此了解的程度
- beat 级别实时更新（Director 在 beat_ready 时同步写入）
- 新 session 开始时加载累积的世界状态

### 3.2 Postgres 数据模型（草案）

```sql
-- 玩家 session
sessions (
  id, player_id, created_at, status,
  current_mode, -- 'global' | 'in-character'
  active_character_id, -- 在场视角下玩家扮演的角色
  task_prompt, -- 玩家原始任务描述
  plot_outline -- Director 生成的粗大纲（JSON）
)

-- 对话历史
messages (
  id, session_id, speaker_id, -- speaker_id = 'player' | 'walter' | ...
  content, emotion_state, gif_search_query,
  beat_id, -- 属于哪个 beat
  created_at
)

-- 剧情 beat
beats (
  id, session_id, beat_index,
  summary, -- 剧情摘要
  status, -- 'pending' | 'acting' | 'ready' | 'skipped'
  director_notes, -- Director 的内部规划
  created_at
)

-- 角色 dossiers（世界状态）
character_dossiers (
  id, session_id, -- nullable, null 表示世界级
  owner_id, -- 这份档案属于哪个角色
  subject_id, -- 档案描述的是哪个角色
  trust_level, -- 信任度 1-10
  knowledge, -- 已知情报（JSON）
  relationship_notes, -- 关系备注
  updated_at
)

-- 角色间通用状态
character_states (
  character_id, -- 'walter' | 'jesse' | ...
  session_id, -- nullable, null 表示世界级
  current_emotion, location, status,
  updated_at
)
```

---

## 4. Communication Layer

### 4.1 SSE 事件流

前端通过 SSE 接收细粒度剧情事件。事件类型：

| 事件类型 | 触发时机 | 携带数据 |
|----------|----------|----------|
| `agent_speak` | 角色说台词 | `{ character_id, content, emotion_state, gif_search_query }` |
| `agent_think` | 角色内心独白 | `{ character_id, thought_content }` |
| `agent_act` | 角色做动作 | `{ character_id, action, target }` |
| `scene_change` | 场景/镜头切换 | `{ from_scene, to_scene, description }` |
| `world_state_delta` | 世界状态变化 | `{ deltas: [{ target, field, old_value, new_value }] }` |
| `beat_ready` | 当前 beat 完成，等玩家决策 | `{ beat_id, beat_summary }` |

### 4.2 事件流示例

```
后端                          前端
 │                              │
 ├─ scene_change ──────────────►│ 渲染：场景从实验室切到 Saul 办公室
 ├─ agent_act ─────────────────►│ 渲染：Walter 放下烧杯，走向电话
 ├─ agent_speak ───────────────►│ 渲染：Walter 说 "我需要见 Saul"
 ├─ agent_speak ───────────────►│ 渲染：Saul 回复 "什么风把你吹来了"
 ├─ world_state_delta ─────────►│ 更新：Walter 对 Saul 的信任度 5→6
 ├─ beat_ready ────────────────►│ 渲染：决策按钮（继续/阻止/改方向/切换视角）
 │                              │
 ◄──── POST /action ───────────│ 玩家点「继续」
 │                              │
 ├─ scene_change ──────────────►│ ...
```

### 4.3 玩家决策 → 后端

```
前端 ──POST /api/session/{id}/action──► 后端
  { action: 'continue' | 'stop' | 'redirect' | 'switch_perspective',
    redirect_prompt?: string,       // '改方向' 时的新指令
    target_character?: string }     // '切换视角' 时的目标角色

后端处理完毕后，开启新 SSE 流推后续事件
```

---

## 5. Model & Routing

### 5.1 模型供应

| 模型 | 提供商 | 协议 | 端点 | 环境变量 |
|------|--------|------|------|----------|
| MiniMax-M3 | MiniMax | Anthropic-compatible | `https://api.minimaxi.com/anthropic/v1/messages` | `MINIMAX_API_KEY` |
| StepFun step-3.7-flash | 阶跃星辰 | OpenAI-compatible | `https://api.stepfun.com/v1/chat/completions` | `STEPFUN_API_KEY` |

### 5.2 场景级路由

同一个角色在不同剧情场景中可能使用不同模型。路由规则由 Director 在每个 beat 中指定，Provider Facade 负责协议转换。

```
Director 决定：Walter + 实验室场景 → 用 MiniMax-M3
Director 决定：Walter + 家庭戏 → 用 StepFun step-3.7-flash

Provider Facade 接收统一调用 → 根据路由规则转换协议 → 转发到对应端点
```

### 5.3 Provider Facade 职责

1. 接收统一模型调用
2. 根据路由规则选择模型
3. 协议转换：
   - MiniMax：Anthropic messages API → 标准 messages 格式
   - StepFun：OpenAI chat completions → 标准 messages 格式
4. 统一返回 `{ model, content, reasoning, usage, latencyMs }`
5. 错误处理和 fallback

---

## 6. Session Lifecycle

```
Session Start
  │
  ├─ 加载世界状态（跨 session 的 dossiers + character_states）
  ├─ 初始化 6 个角色 Sub-agent（注入 voice profile + 工具 + 世界状态）
  ├─ 加载玩家任务
  │
  ▼
Plot Phase (Director)
  │
  ├─ 玩家写自然语言任务
  ├─ Director 生成粗大纲（plot_outline，存 session）
  │
  ▼
Beat Loop
  │
  ├─ Director 决定当前 beat 的：场景 / 出场角色 / 模型路由
  ├─ 调度角色 Sub-agent 逐一演出
  ├─ 产出 SSE 事件流推给前端
  ├─ beat_ready → 等玩家决策
  │
  ├─ 玩家点「继续」→ 下一 beat
  ├─ 玩家点「阻止」→ 终止当前剧情线，等新任务
  ├─ 玩家点「改方向」→ 更新 plot_outline，继续
  ├─ 玩家点「切换视角」→ 切换 active_character_id，继续
  │
  ▼
Session End
  │
  ├─ 全量归档对话历史（保留不删）
  ├─ dossiers 已在 beat 级别实时更新（无需批量处理）
  └─ Session 标记为 completed
```

---

## 7. Migration Plan

### Phase 1：并行建设 — 已完成

- 新建 `backend/` 目录：Python + FastAPI + deepagents + Postgres 骨架
- 前端新建 SSE 事件管理器和剧情控制面板组件
- 旧 Node.js API（`/api/chat`）继续运行，前端同时保留两套调用路径
- 验证最小链路：前端发任务 → Python Director 返回 beat_ready 事件

### Phase 2：功能对齐 — 已完成

- 6 个角色 Sub-agent 逐个接入
- 记忆系统迁移到 Postgres
- 场景级模型路由上线
- 聊天板块接入 Python 后端
- 在场视角 / 全局视角镜头切换
- 旧 Vercel serverless `api/` 目录已移除，前端全面调用 Python 后端

### Phase 3：优化与迭代 — 进行中

- 前端全面切换到 Python 后端 SSE 事件流
- 旧 Node.js middleware 和 `/api/chat` 路由已移除
- 性能优化：context compaction、事件流压缩、记忆索引
- 待完善：SSE 重连机制、多用户 session 管理、dossiers 增量验证

---

## 8. Key Decisions Log

| # | 决策 | 选择 |
|---|------|------|
| 1 | 产品形态 | 玩家布置任务 → Agent 自主演剧情，保留聊天板块 |
| 2 | 任务输入方式 | 自然语言 |
| 3 | 玩家干预粒度 | 每个 beat 停下来等确认 |
| 4 | 聊天与剧情数据边界 | 共享上下文，聊天影响剧情 |
| 5 | 镜头模式 | 全局视角 + 在场视角自由切换 |
| 6 | 第一印象 | 直接演第一个节点，无剧情预告 |
| 7 | 玩家动作集 | 继续 / 阻止 / 改方向 / 切换角色视角 |
| 8 | 在场视角切换角色 | 换扮演的角色，共享工作记忆 |
| 9 | 模式间关系 | 同一 session 自由切换 |
| 10 | 后端技术栈 | Python + FastAPI |
| 11 | 模型供应 | MiniMax-M3 + StepFun step-3.7-flash |
| 12 | 路由策略 | 场景级分层路由 |
| 13 | 通信协议 | SSE 细粒度事件流 |
| 14 | beat_ready 数据 | 仅 beat_id + beat_summary |
| 15 | 决策回传 | HTTP POST + 新 SSE 流 |
| 16 | 前端 | React 19 + Vite 不变 |
| 17 | Session 隔离 | 每个 session 独立一套 Agent |
| 18 | Beat 执行模式 | Plan-then-Emerge 混合 |
| 19 | Dossiers 更新时机 | beat_ready 同步更新 |
| 20 | 对话历史 | 全量保留 |
| 21 | 记忆后端 | Postgres（从第一天用） |
| 22 | 迁移策略 | 并行建设 |

---

## 9. Open Questions

以下问题本轮未深入讨论，后续开发中需要明确：

- 角色 dossiers 的具体字段和更新规则（LLM 生成的 delta 如何验证一致性）
- SSE 重连机制（玩家断线后怎么恢复当前 beat）
- 多用户场景下的 session 管理和资源限制
- 角色工具（tools）从 hand-written prompt 升级到真正的 function calling schema 的改造计划
- 前端镜头切换的 UI/UX 具体形态

---

## 10. SDD+TDD 开发 mandate（铁律）

> 本项目的所有代码修改必须经过 SDD+TDD 闭环。以下规则无例外。

### 10.1 四条铁律

| # | 规则 | 说明 |
|---|------|------|
| 1 | **先写测试，后写实现** | 每个新功能/修复的第一步是写测试，不是写实现代码 |
| 2 | **测试必须先失败（RED）** | 跑一次确认测试失败 — 失败原因必须是"功能未实现"，不是测试写错 |
| 3 | **写最小实现通过测试（GREEN）** | 只写让测试通过的最小代码，不顺手重构，不加未请求的功能 |
| 4 | **全量验证（Closed-Loop）** | 跑完整测试套件确认全绿，不只是新加的测试 |

### 10.2 SDD 场景设计模板

每个功能/修复在写代码前，必须写出 Given/When/Then：

```
Given   <初始状态/前置条件>
When    <触发动作/输入>
Then    <期望结果/断言>
```

示例（B1 fix）：

```
Given   Director 收到任务 "cook in RV"
When    LLM 返回 JSON 数组而非文本列表
Then    _parse_outline 提取出可读的场景描述，不返回以 [ 或 { 开头的字符串
```

### 10.3 测试目录规范

| 层级 | 测试框架 | 目录 | 运行命令 |
|------|----------|------|----------|
| 后端 Python | pytest + pytest-asyncio | `backend/tests/` | `.venv/bin/python -m pytest tests/ -v` |
| 前端 TypeScript | node:test + tsx | `src/tests/` | `npx tsx --test src/tests/` |

### 10.4 不可违反的红线

- 不要为了通过测试而削弱测试（测试 = 需求文档）
- 不要顺手重构相邻代码（改动范围 = 最小必要）
- 不要在测试确认通过前写实现代码
- 不要在生产代码中留 `console.log` 或调试代码
- 测试必须解释**为什么**这个业务规则重要（不只是检查返回值）

### 10.5 工作流集成

项目的 `.claude/workflows/` 目录包含 SDD+TDD 闭环 workflow：
- `bugfix-sdd-tdd-closed-loop.js` — bug 修复流程
- 任何新功能的开发都应遵循相同模式

**关键流程：SDD → TDD RED → TDD GREEN → Closed-Loop**
