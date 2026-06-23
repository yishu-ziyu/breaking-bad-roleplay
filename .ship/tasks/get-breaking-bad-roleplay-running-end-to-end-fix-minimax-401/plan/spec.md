# Spec — Breaking Bad Roleplay Demo-Ready Fix

## Investigation Summary

### Files traced

**Director outline path:**
- `backend/agents/director.py:266-284` — `_generate_outline()` 调用 `provider.call_model()` 生成大纲
- `backend/agents/director.py:286-313` — `_extract_text_from_json_outline()` 和 `_parse_outline()` 处理 LLM 返回
- `backend/agents/provider.py:57-79` — `_call_minimax()` 返回 401（已确认）
- `backend/agents/provider.py:81-96` — `_call_stepfun()` 正常工作（已确认）

**Beat generation path:**
- `backend/agents/director.py:362-505` — `_generate_beat()` 调用 LLM → 解析 JSON 事件 → 分发事件
- `backend/agents/director.py:515-533` — `_parse_beat_events()` 解析 JSON，失败时返回空列表
- `backend/agents/director.py:459-476` — `agent_speak` 时调用角色 sub-agent 获取真实对话

**SSE 流路径:**
- `backend/api/routes.py:154-211` — `/api/session/{id}/stream` 调用 `director.process()`
- `backend/agents/director.py:203-260` — `process()` 产出 AgentEvent 流

**Chat 路径:**
- `backend/api/routes.py:246-294` — `/api/chat` 调用 `director.handle_chat_message()`
- `backend/agents/director.py:539-635` — `_handle_direct_chat()` 单角色回复
- `backend/agents/director.py:637-739` — `_handle_crew_chat()` 多角色辩论

**前端:**
- `src/App.tsx:218` — llmProvider 默认值已改为 stepfun
- `src/App.tsx:476` — MiniMax 选项已移除
- `src/lib/sseClient.ts` — SSE 客户端（待验证）

### Current state after manual verification

| 组件 | 状态 | 证据 |
|------|------|------|
| 后端 health | ✅ | `GET /api/health` → 200 |
| Session 创建 | ✅ | `POST /api/session/create` → session_id |
| Chat (StepFun) | ✅ | Walter 回复含 reply_text + emotion_state + gif_search_query |
| SSE 连接 | ✅ | 事件流建立，status + outline 事件正常 |
| Director 大纲 | ✅ | 4 场景大纲通过 StepFun 生成 |
| Beat JSON 解析 | ⚠️ | Beat 1 解析失败，beat 2+ 正常 |
| MiniMax 路由 | ❌ | 401 Unauthorized |
| 前端模型选项 | ✅ 已清理 | MiniMax 选项移除，默认 StepFun |

### Root cause analysis

**MiniMax 401:**
`provider.py:61-66` 调用 `https://api.minimaxi.com/anthropic/v1/messages` 返回 401。Key 在 `.env` 中配置但已失效。不是代码 bug，是凭证问题。

**Beat 1 JSON 解析失败:**
Director prompt 要求输出 JSON 事件数组，但模型在首 beat 时经常返回描述性文本而非 JSON。`_parse_beat_events()` (`director.py:515-533`) 在找不到 `[` `]` 包围的有效 JSON 时返回空列表，beat 降级。已有 B1 修复（大纲 JSON fallback），但 beat 级别没有同样的容错。

**Scene name 过长:**
大纲返回的每行是完整的场景描述（30+ 词），`_parse_outline()` 能解析，但 `current_scene` 被赋值为整行长文本，导致 scene_change 事件的 `to_scene` 字段过长。

## Acceptance Criteria

见上方 spec.md。
