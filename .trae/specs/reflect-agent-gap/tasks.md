# Tasks

本 spec 是分析性产出，不做代码实现。任务聚焦于：把差距审问固化成一份可评审、可复用的文档，并把它落进项目记忆，避免「反省完就忘」。

- [x] Task 1: 核对差距分析的代码依据
  - [x] 复核 `director.py` 的 beat 编排循环，确认「Director 强编排、角色被动响应」的判断成立
  - [x] 复核 `base.py` 的 `_run_with_tools` 与 `tools.py` 的 `ToolRegistry`，确认「工具不改变可查询世界状态」的判断成立
  - [x] 复核 `continuity_board.py` 与 `memory.py`，确认「世界模型为叙述摘要、无评估-进化闭环」的判断成立
  - [x] 复核 `scenes/`（action_ontology / state_reducer / validator / critic），确认「已有 Verify 层但无 Correct 闭环」的判断成立

- [x] Task 2: 把差距审问固化为可评审文档
  - [x] 将 spec.md 中的「已具备 / 缺口 / 半满」三档与跨境排序，整理为一份对 PM 可读的差距报告（含 Mermaid 的「Affordance 状态图」）
  - [x] 为每个缺口标注对应代码文件与改进方向，作为后续独立 spec 的入口

- [x] Task 3: 把结论写进项目记忆与文档
  - [x] 在 `.trae/specs/reflect-agent-gap` 固化结论，可供后续轮次复用
  - [x] 标记「缺口 1（Workflow→Autonomous）」为下一轮最高优先级候选

- [x] Task 4: 深挖 penguin-harness 的评估-进化闭环
  - [x] 拉取 `Prism-Shadow/penguin-harness` 仓库，定位自进化实现（benchmark-design / agent-evaluation / agent-optimization 三个 skill + self-improving-agent 示例）
  - [x] 确认其 loop 设计（statement/rubric 分离、Reference→Candidate→得分严格提升→快照回滚）契合书本第八章
  - [x] 判断原生实现优于 SDK 集成（TS vs Python 栈不匹配、目标域不同、版本太新）
  - [x] 把「复用设计、原生实现」的结论写入 spec.md 缺口 3

# Task Dependencies

- [Task 2] 依赖 [Task 1]（先核对事实，再写结论）
- [Task 3] 依赖 [Task 2]（结论固化后再落记忆）