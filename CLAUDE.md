# Breaking Bad Roleplay — 项目开发规范

## 当前状态

- Loops 1-7 全部完成
- Loop 4: 6 P0 playability fixes + memory write-read cycle (dossier injection)
- Loop 5: Character consistency eval system (+21 tests, 4-dimension rubric)
- Loop 6: GIF relevance audit + skipGif escape hatch (+5 tests)
- Loop 7: Crew mode per-character prompt injection + DEC-0001 native function calling (+27 tests)
- Loop N (in flight): playable Hank (`hank` / 汉克) — Direct+Crew+Story; DEC-0002; McKee Story engine deferred to next loop
- 当前测试: 后端 character suite green for Hank; full suite re-run before ship
- 线上服务: https://bb.yishuziyu.cn
- 下一轮: McKee《故事》节拍/导演重构（在 Hank 合入后）

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

## 构建与运行

- 前端开发：`npm run dev`（Vite，端口 5173）
- 前端构建：`npm run build`
- 前端测试：`npm test`（tsx test runner）
- 前端 Lint：`npm run lint`
- 后端启动：`cd backend && uvicorn main:app --reload --port 8001`
- 后端测试：`cd backend && uv run pytest`
- E2E：`npx playwright test`
- 数据库迁移：Alembic（`cd backend && alembic upgrade head`）

## 开发工作流：YishuShip 11 阶段循环

PM Intake -> Research -> Definition -> Dev -> QA -> Review -> E2E -> Market -> Score -> Handoff -> Growth -> PM Intake（下一轮）

循环不只在 Dev 结束。完整走完 11 个阶段后才进入下一轮。

停止条件（满足任意一条即停）：
- 总分 >= 7/10 连续 2 轮
- 同一 blocker 连续 2 轮未解决
- 预算耗尽（tokens / USD / 时间）
- 用户明确叫停

### 每个阶段的产出物

| 阶段 | 产出文件 |
|------|----------|
| PM Intake | `.ship/tasks/<task_id>/product/` 下的 00-product-type.yaml, 01-strategy.md, 02-research.md, 03-problem-solution.md |
| Research | `.ship/loop-N-research.md` |
| Definition | `.ship/loop-N-brief.md` |
| Dev | 代码 diff + `.ship/loop-N-dev-report.md` |
| QA | `.ship/loop-N-qa-report.md` |
| Review | `.ship/loop-N-review.md` |
| E2E | `.ship/loop-N-e2e-report.md` |
| Market | `.ship/loop-N-market.md` |
| Score | `.ship/loop-N-scorecard.md` |
| Handoff | `.ship/loop-N-handoff.md` |
| Growth | `.ship/loop-N-growth/` 目录（4 个文件） |

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
角色：Walter, Jesse, Skyler, Saul, Mike, Gus
模式：Direct Chat（一对一）、Crew（多人辩论）、Story（SSE 剧情流）

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
- `backend/agents/provider.py` — LLM provider 适配 + fallback
- `backend/agents/memory.py` — 记忆管理
- `backend/agents/characters/` — 6 个角色 prompt
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

- `docs/OPS_RUNBOOK.md` — 改完怎么 commit / push / 双轨部署 / live smoke
- `docs/FREE_TIER_SECURITY.md` — 平台免费额度与安全边界
- `DEVLOG.md` — 历史部署与坑位时间线

