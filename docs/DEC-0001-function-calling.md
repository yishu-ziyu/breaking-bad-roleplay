# DEC-0001: 角色工具从 hand-written prompt 升级到原生 function calling

- **状态**：Accepted（2026-07-07）
- **决策**：采用 **方案 A — Provider 原生 tool calling（走现有 ProviderFacade）**
- **路由**：pm-intake（架构选型）→ arch-design（详细设计）→ dev
- **关联**：`docs/architecture.md` §9 开放问题「角色工具从 hand-written prompt 升级到真 function calling schema」

---

## Context（背景）

当前角色"工具"是 **hand-written prompt 字段**：`backend/agents/characters/base.py`
的 `STRUCTURED_OUTPUT_PROMPT` 让 LLM 在 JSON 里自由填 `tool_executed` / `tool_log`
两个文本字段；`DirectorAgent` 与 chat handler 把它们当展示文本，**后端不执行任何工具**，
模型只是"演"出一个虚构工具名和结果。

`backend/agents/provider.py` 的 `ProviderFacade.call_model()` 只返回 `str`，无 `tool_calls`
解析、无 `tools` 入参。底层三个端点（MiniMax Anthropic `/v1/messages`、StepFun OpenAI
`/v1/chat/completions`、CLIProxy Anthropic 兼容）**原生都支持 `tools` 参数**。

`pyproject.toml` 依赖中**无任何 agent 框架**（无 deepagents / openai-agents / langchain），
项目是 httpx 手写的极简架构。架构文档里提到的 deepagents 是设想，未落地。

目标（来自 §9）：把"虚构工具字段"升级为**真正的 function calling schema**——模型真实
触发工具、后端真实执行、真实结果回灌剧情。

---

## Considered Alternatives（候选方案与质量评分）

| # | 方案 | 有效质量（本项目上下文） | 说明 |
|---|------|------|------|
| **A** | Provider 原生 tool calling（走现有 Facade） | **≈4.8** | 给 `call_model` 加 `tools` 入参，Facade 做 Anthropic↔OpenAI schema 翻译；后端实现 tool 循环；角色类声明 `tools`。零新重依赖，复用现有抽象层 |
| B | 引入 agent 框架（OpenAI Agents / deepagents） | ≈2.8 | 框架管循环、handoff；但 MiniMax/CLIProxy 非官方 SDK 一等公民需 shim，且与手写 Director 冲突，重做风险高 |
| C | 伪 function calling（约束 JSON 字段触发注册表） | ≈3.0 | provider 无关最稳，但**不算真正 function calling**，靠 prompt 顺从，脆弱，与目标冲突 |

质量维度：工具调用可靠性、结果真实落地、跨 3 provider 可移植性、可维护性/可见性、与现有架构一致性。
A 在"原生 FC 质量收益"与"provider 可移植性"上同时拿满，是本项目质量上限最高的路径。

---

## Decision（决策与理由）

**选 A。** 理由：
1. 目标明确要"真 function calling schema"，C 被目标排除。
2. B 理论质量高，但 provider 不匹配（MiniMax/CLIProxy 在官方 SDK 非一等公民）把它在本项目的
   有效质量拉到最低，且会与手写 Director 编排冲突 → 重做风险最大（正是 PM 层要避免的"选错全重做"）。
3. A 拿到原生 FC 全部质量收益，同时骑在已有 `ProviderFacade` 协议翻译层上规避 B 的 provider 惩罚。
   唯一成本（手写 tool 循环 + schema 翻译）是 bounded、可控、且项目本就全手写。

### A+ 落地形态（框架级结构、零框架依赖）
- 用 **pydantic** 定义每个 tool 的入参 schema（强校验，防模型乱填参数）
- 轻量 **`ToolRegistry`**：角色注册 `tools`，`execute(name, args)` 分发
- **Facade 层**做 Anthropic `tools` ↔ OpenAI `tools` schema 翻译，内部统一表示
- **tool 循环**：`model → tool_calls → registry.execute → 回灌 tool_result → model 续生成`
  （支持多轮 tool 调用，直到模型不再请求工具）

---

## Quality Methodology（采纳 Anthropic Dynamic Workflows 工作方法）

为提升本次实现的代码质量与效率，采纳 Anthropic 官方 *Dynamic Workflows*（2026-05-28）的
**模式**（非 Claude Code 的 JS 运行时）：

- **Orchestrator-Worker**：本对话的主 agent 当编排器，持有一份写死的"计划产物"
  （本决策文档 + 详细设计规格 + 任务拆分），而非每轮重新决策。
- **Plan-in-artifact**：决策与设计先写成文件，后续执行都对照它（等同工作流脚本持有计划）。
- **并行扇出（pipeline）**：互相独立的子任务（如 6 个角色各自的工具 schema）用并行 subagent 同时做。
- **持续修复循环（= 本项目 SDD+TDD 铁律）**：先写测试→确认失败(RED)→最小实现(GREEN)→跑全套至全绿。
- **对抗性验证**：实现后派一个独立 reviewer 子代理交叉审查，不自批自过。

> 注：SDD+TDD 闭环为本项目 `docs/architecture.md` §10 铁律，无例外。

---

## Consequences（影响）

- **后端改动**：`ProviderFacade`、新增 `ToolRegistry`、角色基类和 6 个角色类的 `tools` 声明、
  Director / chat 的 tool 循环。
- **前端不受影响**：`tool_executed` / `tool_log` 仍由 UI 展示，但现在由真实执行结果支撑，
  不再是模型虚构文本（展示层可选择后续用 MUI 做"工具执行检视面板"，不在本 DEC 范围）。
- **依赖**：仅可能新增 `pydantic`（已在生态内），无重型 agent 框架。
- **测试契约**：每个 tool 与其执行路径需有 pytest；`call_model` 新增 `tools` 路径需有 schema
  翻译单测；保持 `cd backend && uv run pytest` 与 `npm test` 全绿。

## Follow-ups

1. `docs/` 下编写详细设计规格（arch-design）：tool schema 结构、Facade 改造点、`ToolRegistry`/
   角色工具清单、tool 循环、SDD+TDD 测试契约。
2. 按 SDD+TDD 实现，经 TDD 闭环 + 对抗性 reviewer 审计后合入。
