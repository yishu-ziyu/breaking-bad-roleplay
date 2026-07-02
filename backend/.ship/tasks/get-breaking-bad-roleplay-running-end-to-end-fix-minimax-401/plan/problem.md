# Problem Statement

## User

一个正在准备黑客松 demo 的独立 builder（就是项目主人自己）。他要向评委展示一个《绝命毒师》主题的 AI 自主剧情角色扮演产品。

## Task

在 demo 现场打开浏览器，选角色关系，输入一个自然语言任务，让 Director Agent 自动生成剧情大纲 + 逐 beat 演出，前端通过 SSE 实时渲染角色对话和内心独白。评委在 3 分钟内看到完整链路跑通。

## Obstacle

当前有三个阻塞点阻止 demo 跑通：

1. **MiniMax API key 401** — 双模型路由中 MiniMax 端认证失败，Director 初始化时调用 MiniMax 生成大纲直接报错。不是架构问题，是 key 失效。
2. **Director beat JSON 解析失败** — Director 要求 LLM 输出 JSON 事件数组，但第一beat 经常返回不符合格式的内容，导致 `_parse_beat_events` 返回空列表，beat 降级为 fallback。
3. **没有已验证的端到端链路** — 虽然 SSE 能连、chat 接口能用 StepFun 返回，但 Director 驱动的自主剧情完整链路（大纲 → beat 事件 → SSE → 前端渲染）没有跑通过。

## Evidence

- 后端 `/api/health` 返回 200
- Chat 接口用 StepFun 能正常返回 Walter 的角色回复（reply_text + emotion_state + gif_search_query）
- Session 创建 + 数据库写入正常
- SSE 连接能建立，但 Director 调 MiniMax 时报 `401 Unauthorized`
- 将路由改为纯 StepFun 后，SSE 能输出 outline 事件，但 beat 1 的 JSON 解析失败
