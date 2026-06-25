# Wave 1 调研报告

## 调研 1：Story API 延迟

| 指标 | 值 |
|------|-----|
| Outline only（system + user，短 prompt） | ~10s |
| Full beats（system + user，长 prompt + JSON 输出） | ~10s |
| 逐 beat 调用（4 beat × 10s） | ~40s（不可接受） |

**结论**：拆成多次调用太慢。必须单次返回全部内容。

## 调研 2：Chat API 角色一致性

已验证：6 个角色的 system prompt + 结构化输出（reply_text + emotion_state + gif_search_query）在 Agnes AI 上工作正常。Walter 回复符合人设（化学术语、冷峻语气）。

## 调研 3：Vercel Serverless 超时

- 免费层：10s 超时
- Pro 层：60s 超时
- 当前 Story API 单次调用约 10s，刚好在边界
- **结论**：单次调用可行，但需要在 API 里加 streaming / chunked 响应来提升感知速度

## 关键决策

**Story 渐进式生成方案**：
- 前端 `/api/story` 接收 `{outline, beats}` 全量响应
- 第一屏只显示 outline（scene 标题列表，无细节描述）
- 用户点"确认 → 开始剧情"后，前端逐 beat 展示
- 每 beat 之间用户点"继续"才显示下一个
- **惊喜感保留**：outline 只有标题（如 "The Blue Sky"），具体对话/动作藏在 beat 里
