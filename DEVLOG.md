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
- Supabase 表需手动在 Dashboard 跑 SQL（CLI 本机 TLS 不通）

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
- 登录后自动同步到 Supabase cloud

---

## 2026-06-26 Wave 3: Supabase Auth + persistence ✅

### 改动
- `src/lib/supabaseClient.ts` — Vite SPA browser client (`@supabase/ssr`)
- `src/hooks/useAuth.ts` — email/password sign-in/sign-up/sign-out
- `src/lib/supabasePersistence.ts` — load + persist chat messages + memory to Supabase
- `src/components/AuthSection.tsx` — sidebar auth UI (sign in / sign up toggle)
- `src/App.tsx` — cloud sync on login, persist on each reply
- `supabase/migrations/20260626120000_create_tables.sql` — chat_messages / character_memory / story_sessions
- `.env.local` — VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY

### 表结构
- `chat_messages` — 每条消息一行（user / 6 角色），RLS 限制仅本人可读写
- `character_memory` — per-user per-character 唯一约束，summary + key_facts JSONB
- `story_sessions` — 故事任务 + 大纲 + beats JSONB（Wave 1 用过本地回放，云端持久化留待 P2）

### Vercel 环境变量
- 通过 `vercel env add VITE_SUPABASE_URL production` / `vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production` 设置
- 触发 `git commit --allow-empty` 重新部署，环境变量在构建时注入前端 bundle
- `.env.local` 是本地开发用，不进 git（已在 `.gitignore`）

### Supabase 自动化调研
- Supabase CLI（`supabase db push`）本机 TLS 握手失败：`failed to connect ... tls error (EOF)`，`db.uacopbotolzdhoidrhjn.supabase.co` DNS 解析到 `198.18.0.225`（假 IP，本机网络封禁）
- 退而求其次：手动在 SQL Editor 跑 5 段 SQL（pgcrypto 扩展 → 3 张表 → 索引 + RLS）
- 后续：等网络环境修复后可改用 `supabase db push` 自动化

### UI 调整
- Auth 表单初始用了 `panel-toggle` + inline style，跟设计系统脱节
- 改用专用类：`auth-input` / `auth-btn-primary`（黄底黑字）/ `auth-btn-secondary`（透明边框）
- 新 CSS 块加入 `src/App.css`，与已有 char-card / seg-control 风格统一

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
