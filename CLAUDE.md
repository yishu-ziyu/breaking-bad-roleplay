先读：[docs/AS_BUILT.md](docs/AS_BUILT.md)

# Breaking Bad Roleplay — 项目开发规范

## 当前状态（as-built）

- 「现在是什么」以 [docs/AS_BUILT.md](docs/AS_BUILT.md) 为索引。
- 当前默认入口：三卡展台，Story / Direct / Crew 直接并列。没有明确要求改入口 → 保持。
- 剧情对访客关闭（2026-09-18 决定，工作区改动，未提交/未部署）：访客点 STORY 卡或玩法条「剧情」只看到「剧情正在开发中」，不进剧情；作者/本地开发用 `?authoring=1`（写入 localStorage `yishu_authoring_mode`，`?authoring=0` 关回去）。开关与文案在 `src/lib/storyAvailability.ts`。见 AS_BUILT §2。
- 线上服务: https://bb.yishuziyu.cn
- 进聊后的 as-built：选角色、建关系再聊（Direct / Crew）；剧情走 SSE。角色见 CONTEXT.md / DEC-0002。这不是与首页竞争的另一套产品定义。
- 六回合夜晚：已实现，只走 `?night=1`，不在默认剧情路径上。不要叫未加限定的「正式局」。
- McKee Story engine v2: `backend/agents/mckee_story.py` (DEC-0003)
- Narrative pipeline as shipped: DEC-0005 (Propose → Validate → Repair → Commit)
- 2026-09-14 接手说明: [docs/HANDOFF_2026-09-14.md](docs/HANDOFF_2026-09-14.md)（发布门禁、Crew 独立采样、临时 Apple 皮肤、how-to 按泄漏打分）
- 色彩科学（必读）: [docs/COLOR_SCIENCE.md](docs/COLOR_SCIENCE.md) — 世界用烟草/褐金/骨白；**让人挑的选项必须是热点，禁止褐上叠褐**。结构可借 Apple 字号，颜色不借 iOS 冷灰。眼下保持现役三卡展台颜色；以后若上夜色/黄绿，同一改动更新 COLOR_SCIENCE。

Historical `.ship` loops, briefs, scorecards, and “下一轮” queues are **not product constraints**. See [docs/PLANNING.md](docs/PLANNING.md).

## 动手前 / 收工

动手前：读本轮要求和 [docs/AS_BUILT.md](docs/AS_BUILT.md)；核对分支、已有提交、未提交 diff。做首页相关工作：先用无预览查询的第一次访问核实现役入口。其他任务：不要重开首页。

当前默认入口：三卡展台，Story / Direct / Crew 直接并列。没有明确要求改入口 → 保持。

旧版本：夜路页、黄色「开始这一夜」页、杰西插画封面，不因为仓库里还有文件或截图就当成候选项。

对不上时：写清「实际在跑什么」和「哪份文档在打架」。不要回退到旧页；不要把未做完的目标写成已上线。

只有用户要求、或新证据会改目标时，才重开讨论。「仓库里还有另一版」不是新证据。

收工时写：改了什么 / 没改什么 / 核了什么。如果改了入口，同一改动更新 AS_BUILT 和测试。没上线就写没上线。

工作区可能有未提交、未上 origin 的单聊（Direct-chat）改动。不要覆盖、stash 走、或塞进无关提交。

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
- 后端启动：`cd backend && uv run python -m uvicorn main:app --reload --port 8001`（venv console script 的 shebang 可能断裂：`uv run uvicorn` 会静默换解释器；见 docs/OPS_RUNBOOK.md）
- 后端测试：`cd backend && uv run python -m pytest`
- E2E：`npx playwright test`
- 数据库迁移：Alembic（`cd backend && uv run python -m alembic upgrade head`）。路径含空格或目录改名后 `uv run alembic` 会因 shebang 断裂失败；后端启动会校验 DB revision 是否在 head，落后则打印这条命令并以非 0 退出。

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
- 后端改动：`cd backend && uv run python -m pytest`
- 部署改动：health check + 浏览器 smoke test
- UI 改动：截图验证，不能只看代码

## 产品定位

本轮用户确认的最高产品边界：Direct 是独立一对一 AI 角色聊天，Crew 是独立多角色 AI 聊天；只有 Story 采用「局势→行动→结算→后果」游戏循环。不得强制联动、共享私聊记忆或用 Story 玩家身份替换聊天对象。实现与验收见 `docs/specs/chat-story-mode-boundaries.md`。

这是一个《绝命毒师》主题的 AI 角色扮演。默认打开是 Story / Direct / Crew 三卡展台。入口以 [docs/AS_BUILT.md](docs/AS_BUILT.md) 为准。

进聊后的 as-built：选角色 -> 建立关系锚点 -> 对话 / 剧情演绎。这是聊天侧已落地的流程，不是另一套首页定义。
角色：Walter, Jesse, Skyler, Saul, Mike, Gus, Hank, Marie（8 人；见 CONTEXT.md / DEC-0002；Marie 于 2026-09-18 接入导演，见 CONTEXT.md「Marie (playable)」）
模式：Direct Chat（一对一）、Crew（多人辩论）、Story（SSE 剧情流；大纲规划见 DEC-0003 McKee）。六回合夜晚已实现，只 `?night=1`，不是默认剧情。

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
- `backend/agents/characters/` — 8 个角色 prompt（含 hank / 汉克、marie / 玛丽）
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
cd backend && uv run python -m uvicorn main:app --reload --port 8001   # 后端（-m 绕开可能断掉的 venv shebang）
cd backend && uv run python -m alembic upgrade head                    # 迁移（同一原因）

# 测试
npm test                       # 前端单测
cd backend && uv run python -m pytest    # 后端单测
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

- `docs/AS_BUILT.md` — 「现在是什么」的索引；入口、玩法可达性以它为准
- `docs/PLANNING.md` — 历史计划仅供参考，不约束产品
- `docs/OPS_RUNBOOK.md` — 改完怎么 commit / push / 双轨部署 / live smoke
- `docs/FREE_TIER_SECURITY.md` — 平台免费额度与安全边界
- `DEVLOG.md` — 历史部署与坑位时间线

