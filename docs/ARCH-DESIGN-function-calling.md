# ARCH-DESIGN: 角色工具原生 function calling（方案 A 详细设计）

- **关联决策**：`docs/DEC-0001-function-calling.md`（选 A）
- **路由**：arch-design
- **工作方法**：Anthropic Dynamic Workflows（orchestrator-worker / plan-in-artifact / 持续修复循环 / 对抗性验证）
- **铁律**：本项目 `docs/architecture.md` §10 SDD+TDD 闭环（先测试后实现、RED→GREEN→全绿）

---

## 1. 内部统一 Tool 表示（provider-agnostic）

新增 `backend/agents/tools.py`：

```python
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

@dataclass
class Tool:
    name: str                      # 工具名，如 "lab_pressure_simulator"
    description: str               # 给模型的工具说明
    parameters_json_schema: dict   # JSON Schema（input_schema）
    # 执行器：name -> 协程；由 ToolRegistry 按 name 分发，不在 Tool 上直接挂函数
    # 以便 Tool 可序列化、可跨 provider 翻译

@dataclass
class ToolCall:
    id: str                        # provider 返回的调用 id
    name: str
    arguments: dict                # 已解析的参数（OpenAI 的 JSON 字符串在此解析）

@dataclass
class ToolResult:
    content: str                   # 回灌给模型的工具结果文本
    is_error: bool = False
```

### 跨 provider schema 翻译（在 Facade 内）
- **→ Anthropic**：`tools=[{"name","description","input_schema": parameters_json_schema}]`
- **→ OpenAI**：`tools=[{"type":"function","function":{"name","description","parameters": parameters_json_schema}}]`
- 响应解析统一为 `ToolCall`：
  - Anthropic：`stop_reason=="tool_use"` → `content` 块 `type=="tool_use"`（`id`,`name`,`input`）
  - OpenAI：`message.tool_calls`（`id`,`function.name`,`function.arguments` JSON 字符串 → `json.loads`）

---

## 2. ProviderFacade 改造

`backend/agents/provider.py` 现状：`call_model(messages, model_route) -> str`（仅文本）。

新增（**不破坏旧签名**，旧调用方继续可用）：

```python
@dataclass
class ModelResult:
    content: str                   # 最终文本（无工具调用时即助手回复）
    tool_calls: list[ToolCall]     # 空列表表示本轮无工具调用
    stop_reason: str | None

async def call_model_with_tools(
    self, messages, model_route, tools: list[Tool], tool_choice: str = "auto"
) -> ModelResult:
    ...
```

- MiniMax / CLIProxy（Anthropic 兼容）：请求体加 `tools`；解析 `tool_use` 块。
- StepFun（OpenAI 兼容）：请求体加 `tools`；解析 `tool_calls`。
- `_translate_tools_to_anthropic` / `_translate_tools_to_openai` 私有方法。
- 失败时（HTTP 错误）保持现有 fallback 行为，但 `tool_calls` 置空、记录 warning。

> 旧 `call_model` 保留给 outline 生成、crew chat 等不需要工具的路径，零回归。

---

## 3. ToolRegistry

`backend/agents/tools.py`：

```python
class ToolRegistry:
    def __init__(self): self._executors: dict[str, Callable[[dict], Awaitable[ToolResult]]] = {}
    def register(self, name: str, executor): self._executors[name] = executor
    async def execute(self, name: str, arguments: dict) -> ToolResult:
        fn = self._executors.get(name)
        if fn is None: return ToolResult(content=f"unknown tool: {name}", is_error=True)
        try: return await fn(arguments)
        except Exception as e: return ToolResult(content=f"tool error: {e}", is_error=True)
```

角色在构造时把自己的 `tools` 与对应 executor 注册进传入的 registry（或在 `respond_structured`
里按 `self.tools` 直接分发）。

---

## 4. 角色工具清单（来自 `architecture.md` §2.3）

| 角色 | 工具名 | 真实执行语义（默认 = 确定性 Python，可测、零额外 LLM 调用） |
|------|--------|------|
| Walter White | `lab_pressure_simulator` | 入参 `{compound, temperature_c, pressure_psi}` → 确定性公式返回反应器状态（稳定/临界/失控）+ 数值 |
| Saul Goodman | `legal_risk_assessor` | 入参 `{action_description}` → 规则命中（关键词/正则）返回 `low/medium/high` 风险 + 理由 |
| Mike Ehrmantraut | `security_posture_reader` | 入参 `{location}` → 读 world_state/Postgres 返回该地点警戒等级（真实 DB 读） |
| Gus Fring | `compliance_checker` | 入参 `{operation}` → 规则校验返回合规/不合规 + 缺口项 |
| Jesse Pinkman | `cook_yield_estimator` | 入参 `{batch_size_oz, purity_target_percent}` → 确定性公式返回预估产量(克) + 质量档(达标/掺假/报废) |
| Skyler White | `financial_exposure_check` | 入参 `{venture, amount_usd}` → 规则评估家庭资产暴露等级 `low/medium/high` + 警示 |

> **工具越多越好**：6 个角色全部配工具；后续可继续为任意角色追加更多工具（注册即用，零改 Facade）。

> **需确认的产品决策（建议默认）**：叙事型工具的"真实执行"默认用**确定性 Python 函数**
> （必要时读 world_state），不额外调 LLM——可控、可测、成本低。若你希望某些工具改为
> "模型二次推理"，可在实现后逐工具切换。当前按默认推进。

---

## 5. Tool 循环（接入点）

在 `BaseCharacter.respond_structured`（及 Director beat 的 agent_speak 子代理调用）中，
**替换原 `tool_executed`/`tool_log` 自由文本字段**为真实循环：

```
tools = self.tools  # 角色声明
result = await provider.call_model_with_tools(messages, route, tools)
rounds = 0
while result.tool_calls and rounds < MAX_TOOL_ROUNDS:   # MAX_TOOL_ROUNDS = 4
    for tc in result.tool_calls:
        tool_result = await registry.execute(tc.name, tc.arguments)
        messages.append(tool_result_message(tc, tool_result))   # Anthropic: user+tool_result 块; OpenAI: role=tool
    result = await provider.call_model_with_tools(messages, route, tools)
    rounds += 1
# 最终文本仍按 STRUCTURED_OUTPUT_PROMPT 解析 reply_text/emotion/gif
# 并把本轮真实 tool 结果回填进 tool_executed/tool_log，UI 契约不变
```

UI 侧（`tool_executed` / `tool_log`）继续工作，但现在内容来自**真实执行**，不再是模型虚构。

---

## 6. SDD+TDD 测试契约（先于实现）

| 测试文件 | 验证点 |
|----------|--------|
| `backend/tests/test_tools_translation.py` | Anthropic↔OpenAI schema 翻译 round-trip；ToolCall 解析（两 provider，mock HTTP） |
| `backend/tests/test_tool_registry.py` | register / execute / 未知工具返回 is_error |
| `backend/tests/test_character_tools.py` | 每个角色 `tools` 声明存在；`lab_pressure_simulator` 确定性返回；registry 执行成功 |
| `backend/tests/test_tool_loop.py` | 2 轮 tool 循环终止；最终 envelope 的 tool_executed/tool_log 来自真实结果 |
| 回归 | `cd backend && uv run pytest` 全绿；`npm test` 全绿（前端未改） |

---

## 7. 实施顺序（orchestrator 拆分 → 并行 worker 可并行项）

1. `tools.py`：Tool/ToolCall/ToolResult/ToolRegistry + 翻译/解析函数（**已建，纯新增**）
2. `provider.py`：`ModelResult` + `call_model_with_tools` + 两 provider 翻译/解析（TDD）
3. 角色 `tools` 声明 + 4 个 executor（Walter/Saul/Mike/Gus 可并行实现）
4. `BaseCharacter.respond_structured` 接 tool 循环；Director beat 子代理调用同步
5. TDD 闭环 + 派独立 reviewer 子代理对抗性审计

---

## 8. 实现说明 / 对抗性审计修正（已落地）

独立 reviewer 子代理对抗性审计后，对原始设计做了三处**正确性修正**（均已补 TDD 回归测试）：

### 8.1 多轮工具循环必须重建 assistant 轮次（CRITICAL）
`_run_with_tools` 在模型请求工具后，除追加 `tool_result` 消息，还必须**先**把带 `tool_use` 的
assistant 轮次追加回 `messages`——Anthropic 与 OpenAI 都要求 assistant(tool_use) 出现在
tool_result 之前，否则第二次 `call_model_with_tools` 的整轮会话结构非法。
新增 `tools.py:assistant_message_with_tools(provider_prefix, result)`，按 provider 前缀重建
Anthropic（block `{type:"tool_use"}`）或 OpenAI（`tool_calls:[{function}]`）形态。
`test_tool_loop.py` 现断言第二轮回合的 messages 同时含 assistant(tool_use) 与 user(tool_result)。

### 8.2 CLIProxy（Anthropic）不能扁平化块列表内容（CRITICAL）
原 `_call_cli_proxy(_with_tools)` 对每条 message 的 `content` 做 `str(content)`，会把工具循环产生的
**块列表**（`tool_use` / `tool_result` blocks）破坏成字符串，并丢弃 `role="tool"` 消息——而 Director
默认把角色子代理调用路由到 `cliproxy/`，等于在主路径上使原生 FC 失效。
新增 `provider.py:_split_anthropic_messages()`：块列表原样透传、纯文本 `str()`、OpenAI 风格
`role=tool` 折叠进上一轮 user 的 `tool_result` 块。MiniMax 路径本就原样透传，现已一致。
`test_provider_tools.py:test_cliproxy_preserves_block_content_in_tool_loop` 锁定该行为。

### 8.3 健壮性修正（MEDIUM）
- `tools.py:ToolRegistry.execute` 捕获异常后 `logger.warning` 便于排障（原仅字符串回灌）。
- `provider.py:_model_result_from_anthropic` 不再仅依赖 `stop_reason=="tool_use"`，当 content 含
  `tool_use` 块时也解析（兼容部分 Anthropic 兼容端点）。
- `call_model_with_tools` 在 `tools` 为空时**不发送** `tools`/`tool_choice` 字段（避免 OpenAI
  空 `tools:[]` 报错），并为下一节兜底提供支持。
- `_run_with_tools` 达到 `MAX_TOOL_ROUNDS` 仍 `tool_calls` 非空时，用空 tools 强制做一次收尾补全，
  用户不会看到空 envelope。
- `respond_structured` 当 `self.tools` 非空但本轮**未触发真实工具**时，显式清空
  `tool_executed`/`tool_log`（DEC-0001 要求证据来自真实执行，不得透出模型虚构值）。

### 8.4 全量闭环
`cd backend && uv run pytest` → **139 passed**（含 19 个本特性新增/修正测试）。前端未改，无需 `npm test`。
