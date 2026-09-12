# Breaking Bad Roleplay — 项目开发规范

## 当前状态（as-built）

- 线上服务: https://bb.yishuziyu.cn
- Playable: Walter, Jesse, Skyler, Saul, Mike, Gus, Hank — Direct / Crew / Story
- McKee Story engine v2: `backend/agents/mckee_story.py` (DEC-0003)
- Narrative pipeline as shipped: DEC-0005 (Propose → Validate → Repair → Commit)

Historical `.ship` loops, briefs, scorecards, and “下一轮” queues are **not product constraints**. See [docs/PLANNING.md](docs/PLANNING.md).

## 项目特有运维（必读）

本仓库有一套**只对本项目成立**的小动作习惯（双轨部署、Vercel 体积、VM 容器名、GIF 目视验收等）。
改完代码不等于上线。完整清单见：

**[docs/OPS_RUNBOOK.md](docs/OPS_RUNBOOK.md)**

最短记忆：

1. `git push origin main` 之后还要部署。
2. **主生产**：Docker VM `121.89.90.68` / 容器 `bb-roleplay` / 目录 `/opt/breaking-bad-roleplay`。
3. **前端捷径**：根目录 `vercel --prod --yes`（注意 `.vercelignore`，上传约 100MB 上限）。
4. 动 API / quota / TTS / 迁移 → 必须重建 VM；纯 UI 至少 Vercel，必要时两边都更。
5. 上线后打开 **https://bb.yishuziyu.cn** 做 60 秒 smoke，不要只看 localhost。
6. 改 `roleAssets.ts` GIF：下首帧目视确认角色，禁止 meme / 错片。
7. 不要动同机 `gun.yishuziyu.cn` 的 Nginx。

新踩到的项目专属坑：同一会话内补进 `docs/OPS_RUNBOOK.md`，不要只留在对话里。

## 预览方式

- 需要打开本地预览时，**默认用 ZCode 内置浏览器**（browser-use `iab`）打开，不要用 `open` 唤起系统浏览器
- 本项目 dev 端口是 5176（vite.config.ts 固定，避开其他项目占用的 5173/5175/8080）；后端 8001，`VITE_API_PROXY_TARGET=http://127.0.0.1:8001 npm run dev`
- 机器上 5173（econpaper）、5175（creator-live-preview）、8080（paper-echo）、8002（DeepTutor）被其他项目常驻占用，不要误连

## 构建与运行

- 前端开发：`npm run dev`（Vite，端口 5176）
- 前端构建：`npm run build`
- 前端测试：`npm test`（tsx test runner）
- 前端 Lint：`npm run lint`
- 后端启动：`cd backend && uvicorn main:app --reload --port 8001`
- 后端测试：`cd backend && uv run pytest`
- E2E：`npx playwright test`
- 数据库迁移：Alembic（`cd backend && alembic upgrade head`）

## 历史循环（不约束产品）

YishuShip 11 阶段与 `.ship/loop-N-*` 产出是历史流程，已归档。不要把它们当成必须继续执行的产品计划。归档入口：[docs/PLANNING.md](docs/PLANNING.md)。

## 强制 SDD + BDD + TDD 闭环

没有测试就不写实现。测试必须先失败（RED），然后实现让测试通过（GREEN）。

流程：
1. SDD：先写 Given/When/Then 场景描述
2. TDD RED：写测试，确认失败
3. TDD GREEN：最小实现让测试通过
4. 闭环：跑全量测试套件，确认全绿

## 验证标准

改动完成后必须跑对应检查：
- 前端改动：`npm run build` + `npm test` + `npm run lint`
- 后端改动：`cd backend && uv run pytest`
- 部署改动：health check + 浏览器 smoke test
- UI 改动：截图验证，不能只看代码

## 产品定位

这是一个《绝命毒师》主题的 AI 角色扮演对话原型，不是普通聊天机器人。

核心体验：选角色 -> 建立关系锚点 -> 对话 / 剧情演绎
角色：Walter, Jesse, Skyler, Saul, Mike, Gus, Hank（见 CONTEXT.md / DEC-0002）
模式：Direct Chat（一对一）、Crew（多人辩论）、Story（SSE 剧情流；大纲规划见 DEC-0003 McKee）

安全边界：禁止生成现实世界犯罪操作指导（制毒、暴力、洗钱等），戏剧张力保留，虚构语境内允许。

## 技术架构

- 前端：React 19 + TypeScript + Vite 8，单页应用
- 后端：FastAPI + SQLAlchemy + Alembic，Docker 部署
- 数据库：PostgreSQL（Supabase 托管）
- 认证：Supabase Auth（email/password），RLS 行级安全
- LLM：MiniMax-M3 / StepFun / Agnes AI，后端代理，API key 不暴露前端
- 部署：Docker VM（121.89.90.68）+ Nginx 反代 + Let's Encrypt TLS

## 前端关键文件

- `src/App.tsx` — 主应用壳，包含所有核心 UI 逻辑
- `src/App.css` — 主样式
- `src/hooks/useStoryStream.ts` — Story SSE 流 hook
- `src/hooks/useCharacterMemory.ts` — 角色记忆滑动窗口
- `src/hooks/useAuth.ts` — Supabase 认证
- `src/lib/privacyVault.ts` — 客户端 AES-GCM 加密
- `src/lib/sseClient.ts` — SSE 客户端
- `src/roleProfiles.ts` / `src/roleAssets.ts` — 角色定义

## 后端关键文件

- `backend/main.py` — FastAPI 入口
- `backend/api/routes.py` — API 路由
- `backend/agents/director.py` — Director 剧情引擎
- `backend/agents/mckee_story.py` — McKee Story 大纲/节拍规划（DEC-0003）
- `backend/agents/provider.py` — LLM provider 适配 + fallback
- `backend/agents/memory.py` — 记忆管理
- `backend/agents/characters/` — 7 个角色 prompt（含 hank / 汉克）
- `backend/db/` + `backend/alembic/` — 数据库和迁移

## 代码风格

- TypeScript strict mode
- 前端用 ESLint（react-hooks + react-refresh 插件）
- 后端用 uv 管理 Python 依赖
- Git commit message：conventional commits（feat / fix / docs 等）
- 禁止提交真实 API key / 数据库密码

## 快速命令

```bash
# 开发
npm run dev                    # 前端 dev server
cd backend && uvicorn main:app --reload --port 8001   # 后端

# 测试
npm test                       # 前端单测
cd backend && uv run pytest    # 后端单测
npx playwright test            # E2E

# 构建
npm run build                  # 前端构建
npm run lint                   # Lint

# 部署相关
npm run verify:rls             # Supabase RLS 验证
vercel --prod --yes            # Vercel 生产（见 docs/OPS_RUNBOOK.md）
# Docker VM: rsync -> rebuild bb-roleplay on 121.89.90.68（见 docs/OPS_RUNBOOK.md）
```

## 相关文档

- `docs/PLANNING.md` — 历史计划仅供参考，不约束产品
- `docs/OPS_RUNBOOK.md` — 改完怎么 commit / push / 双轨部署 / live smoke
- `docs/FREE_TIER_SECURITY.md` — 平台免费额度与安全边界
- `DEVLOG.md` — 历史部署与坑位时间线

