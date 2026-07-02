# Scope

## Appetite

2-day spike。目标是 demo 前把核心链路跑通，不是生产化。

## In Scope

- 将模型路由降级为 StepFun-only（已有改动，验证完整性）
- 修复 Director 大纲生成 + beat 事件 JSON 解析，保证至少 3 个 beat 完整输出事件
- 验证 SSE 事件流从 Director 到前端的完整链路
- 验证前端 chat 模式（direct + crew）能正常显示角色回复
- 验证 session 创建 → 流 → 玩家决策 → 下一 beat 的基本循环
- 修复前端 MiniMax 选项（已移除，确认无残留引用）
- demo 场景的 polish：确保关键路径没有 404 / 500 / 空状态

## Out of Scope

- MiniMax key  procurement 或 MiniMax 路由恢复（后续单独处理）
- Stage 4+ 功能（多 agent 协作、WebContainer、资产版本控制）
- 前端视觉 redesign
- 移动端响应式优化
- 暗色模式
- 性能优化（>200 资产虚拟滚动等）
- Postgres 之外的持久化方案
- 多用户认证 / session 资源限制

## Risks

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| StepFun 模型在复杂 beat 中仍然返回非 JSON | 中 | 高 | 加强 prompt 约束 + 多层 fallback 解析 |
| SSE 前端断连后无法恢复 | 中 | 高 | Demo 场景不触发断连，记录为后续 TODO |
| beat_ready 后前端没有决策按钮 | 低 | 高 | 手动验证前端组件是否渲染 |
| 数据库连接在 demo 环境不可用 | 低 | 高 | 本地已验证，demo 前重新确认 |
| StepFun 限流 / 延迟 | 低 | 中 | 有指数退避，demo 前测一次真实延迟 |

## Open Questions

- beat 1 JSON 解析失败是因为 prompt 不够强，还是模型本身不遵守格式？（需要实际观察多次输出）
- Director 大纲生成的 plain text 格式与 beat JSON 格式之间的切换是否清晰？（已修复 prompt 区分）
- 前端 `model_route: null` 在事件中的显示是否影响渲染？（需要前端验证）
