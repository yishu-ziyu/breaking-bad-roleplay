# Breaking Bad Roleplay — 开发日志

## 2026-06-26 Vercel 部署成功 ✅

### 最终部署方案
- **平台**: Vercel（免费 Hobby 计划，不要信用卡）
- **URL**: https://breaking-bad-roleplay.vercel.app
- **前端**: React 19 + Vite 8（静态文件）
- **后端**: Vercel Serverless Function（`api/chat.py`，Python）
- **LLM**: Agnes AI `agnes-2.0-flash`（免费公测期）
- **模式**: Chat（Direct + Crew），Story 模式暂不可用（需要 SSE）

### 技术细节
- `api/chat.py` 是自包含的 Vercel Python serverless function，不依赖 FastAPI
- 直接调用 Agnes AI OpenAI-compatible API
- 6 个角色 system prompt 全部内嵌
- 结构化输出（reply_text, emotion_state, gif_search_query, thinking, tool_executed, tool_log）
- 支持 Direct 和 Crew 两种模式

### 部署过程中解决的问题
1. lint 9 errors → 全部修复（0 errors, 7 warnings）
2. tool-safety.test.js 引用不存在文件 → 更新为检查 Python 后端
3. Render 免费时长用完 → 切到 Vercel
4. StepFun/MiniMax API key 失效 → 切到 Agnes AI（免费）
5. Vercel 项目框架被设为 "services" → 通过 API 改回 "vite"
6. vercel.json experimentalServices 冲突 → 简化配置

### 已知限制
- Story 模式（Director 自主演绎）已通过本地回放实现（Wave 1）

---

## 2026-06-26 Wave 1: Story 渐进式生成 ✅

### 改动
- `src/App.tsx` — 3-phase Story UI：输入 → 大纲确认 → Beat 逐条回放
- `src/hooks/useStoryStream.ts` — outline-confirm + local replay 模式
- `src/App.css` — 新增 ~200 行 story UI 样式
- `api/story.py` — 单次返回 `{outline, beats}` 全量响应
- `api/chat.py` — 多 LLM provider 支持（agnes/stepfun/deepseek/minimax）

### 核心决策
- 单次 LLM 调用（~10s）返回全部 beats，前端本地回放
- 大纲只显示标题（无细节），确认后才展示 beat 内容
- 保留惊喜感

---

## 2026-06-26 Wave 2: 角色记忆滑动窗口 ✅

### 改动
- `src/hooks/useCharacterMemory.ts` — 新建，8-turn 滑动窗口 + 摘要 + 关键事实提取
- `api/chat.py` — `memorySummary` + `keyFacts` 注入 system prompt
- `src/App.tsx` — 接入 memory hook，per-character 持久化

### 机制
- 最近 8 轮：完整上下文（前端 history 已传）
- 更早轮次：压缩为摘要（500 字符 cap）
- 关键事实：5 类关键词提取（person/location/secret/relationship/event）
- 按角色持久化到 localStorage
- 无数据库（消息存在浏览器 localStorage）

## 2026-06-24 部署调研（未完成）

### 背景
- 代码已全部写完并推送到 GitHub（私有仓库 `yishu-ziyu/breaking-bad-roleplay`）
- 前端已预编译（`dist/` 存在），后端 `start.py` + `requirements.txt` 就绪
- 目标：部署到公网可访问 URL

### Railway 部署失败记录
- 尝试 3+ 小时，失败原因：
  - GitHub App 集成问题
  - 代理冲突
  - CLI auth 过期
  - Railpack builder 各种报错
  - 换 Dockerfile 后仍失败
- **结论：放弃 Railway，切换平台**

### 平台调研结论
- 对比 Render / Fly.io / Vercel / Railway
- **推荐 Render**：支持 Docker、内置 Postgres、GitHub 集成简单、非技术用户友好
- 唯一缺点：免费层 15 分钟无流量休眠（黑客松 demo 够用）

### 部署准备状态（等待用户确认）
- [ ] Render 账号（新建 or 已有？）
- [ ] GitHub 授权（Render 访问私有仓库）
- [ ] API Keys（MINIMAX_API_KEY、STEPFUN_API_KEY）
- [ ] 执行部署流程（待续）

### 技术架构
- 前端：React 19 + TypeScript + Vite 8（`dist/` 预编译）
- 后端：FastAPI + uvicorn + SQLAlchemy + asyncpg
- 数据库：PostgreSQL（自动 create_all）
- 部署：Dockerfile（python:3.12-slim，同时服务后端 + 前端静态文件）
- 入口：`start.py`（读 PORT env，启动 uvicorn）
- Health：`/api/health`
