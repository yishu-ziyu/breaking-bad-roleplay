# Breaking Bad Roleplay — 开发日志

## 2026-07-10 Loop 8: Story mode language enforcement + hardening ✅

### 背景
- Loop 8 PM Intake 由子 Agent 完成（`.ship/loop-8-brief.md`）。
- Track A: 线上体验加固（SSE heartbeat 分析后判定不适合当前应用节奏，revert + 删除 dead code；修复后端错误消息敏感信息泄漏回归）。
- Track B: Story 模式强制角色 prompt 遵守玩家语言选择。

### 改动
- `backend/agents/director.py` — 新增 `LANG_DIRECTIVE` dict + `_language_directive()` helper；`process()`、`_generate_outline()`、`_generate_outline_followup()`、`_generate_branch_outline()`、`_generate_beat()` 全部加 `language` 参数；outline prompt user message 和角色 sub-agent prompt 注入语言指令。
- `backend/api/routes.py` — `stream_session()` 加 `language` query param，传入 `director.process()`。
- `backend/models/schemas.py` — `SessionCreate` 新增 `language: str = "en"`。
- `src/hooks/useStoryStream.ts` — `startStory` 和 `connectStream` 加 `language` 参数，session create body 和 SSE URL query string 都传 language。
- `src/App.tsx` — 4 个 `startStory` 调用点（handleStartStory、handleContinueChapter、handleBranchStory、handleReplayBeat）全部传 `language`，dependency array 同步更新。
- `backend/tests/test_story_language.py` — 新增 3 个 TDD 测试（zh directive、en directive、outline prompt 语言指令）。
- 删除 `src/lib/sseClient.ts` — 整个文件是 dead code（零导入），heartbeat 修复无意义。

### 决策记录
- SSE heartbeat: 从第一性原理分析，应用 beat 之间合法沉默 5 分钟，45s 超时会打断正常等待流程。结论：revert，删除 dead code 文件。如果未来需要 heartbeat，需服务端 keepalive 配合。

### 验证
- `npm test` — 55 passed
- `npm run lint` — passed
- `npm run build` — passed
- `cd backend && uv run pytest` — 172 passed (169 原有 + 3 新)
- `npx playwright test` — 25 passed, 1 skipped
- Playwright playthrough: 中文 UI + Story 模式语言强制验证通过

## 2026-07-07 Story Board HUD reference pass ✅

### 背景
- 用户认可参考图方向：Albuquerque case-file / director system / paper dossier / timeline HUD。
- 本轮目标是把这个视觉语言先落到 Story 视图的真实玩法界面，不做全量重写，不引入假指标。
- 使用并行只读 code reviewer lane；主线程同时用 Computer Use 在 Chrome 里做真实玩家路径检查。

### 改动
- `src/App.tsx` — Story 视图顶部改为 HUD 信息条；streaming / paused / complete 状态改为 storyboard 布局；新增当前事件摘要、卡片标题、真实 `to_scene` 地点显示和中文 fallback。
- `src/App.css` — Story stream 改为左侧 timeline + 右侧纸质 scene card + pressure footer；导演选择按钮改为卡片式 decision tray；暂停态压缩 board 高度，保证下一步选择在 1440×900 首屏内可见；补 responsive 和 focus/contrast 收口。
- `.ship/tasks/story-board-hud-2026-07-07/notes.md` — 记录参考图拆解、subagent review 反馈、Computer Use 试玩结论和验收命令。

### 验证
- `npm run lint` — passed
- `npm test` — 47 passed
- `npm run build` — passed
- `npx playwright test tests/e2e/sse-story.spec.ts --reporter=line --output=/tmp/bbr-playwright-output` — 11 passed
- Computer Use 试玩：Chrome 进入 Story → 输入剧情 → Start Story → 观察 HUD / timeline / scene card；发现并修复 story card headline 层级问题。

### Reviewer 修复
- 恢复 `.story-outline p` 的真实 director outline，摘要改为非 `p`，避免破坏既有 e2e selector。
- HUD Location 优先使用 SSE `scene_change.data.to_scene`，只在缺失时 fallback 到 description。
- 中文界面的默认地点从 `North of ABQ` 改为 `阿尔伯克基北部`。
- 右侧 scene card 只追踪 scene/action/thought/dialogue；`beat_ready` 与 `world_state_delta` 保留在 timeline、pressure footer 和 decision tray，不再抢主卡标题。

## 2026-07-07 Visual redesign pass ✅

### 背景
- 对 landing、story setup、chat、story stream、mobile entry 做完整视觉分析与实现收口。
- 使用并行只读子 Agent：一条 UX/视觉审计，一条《绝命毒师》玩家试玩预期审计；主 Agent 负责截图、设计方向、集成和验收。
- 设计参考与最终截图保存在 `.ship/tasks/visual-redesign-2026-07-07/`。

### 改动
- `src/App.tsx` — 增加关系压力档案和 chat header 压力摘要；opening GIF 不再显示；GIF keyword caption 不再暴露给玩家；chat 自动滚动改为只滚动 `.chat-stream` 容器；`Beat 0` 改为从 Beat/节点 1 起显示；系统化文案改为 scene/beat/consequence 语境。
- `src/App.css` — landing 增强首屏可读性；chat 消息改为更像剧本台词卡；story event、world delta、streaming、redirect/perspective、save prompt、focus-visible 补样式；移动端 sidebar/story 密度收口；添加 reduced-motion 兜底。
- `src/styles/tokens.css` — 新增 `--font-display`，用于标题/案卷气质，正文仍沿用现有可读体系。
- `.ship/tasks/visual-redesign-2026-07-07/visual-audit.md` — 记录视觉问题、实现、验收与剩余风险。

### 验证
- `npm run lint` — passed
- `npm test` — 47 passed
- `npm run build` — passed
- Playwright 视觉 smoke：`chatCaptionCount: 0`、`openerGifVisible: 0`、`scrollYAfterChat: 0`、`sidebarScrollAfterChat: 0`

### 剩余风险
- 后端 stream payload 里仍可能出现 `Director is analysing...` 之类状态文案；本轮只改前端展示层。
- 完整 GIF 策略后续应进入显式 `show_gif` / beat-strength schema，而不是只靠前端 suppression。

## 2026-07-07 Parallel review + BB player lane ✅

### 背景
- 用户提出：实现者每完成一步后，应有并行 reviewer 审核；另一个 agent 扮演懂《绝命毒师》的玩家，试玩并指出不符合预期的地方。
- 复用 yishuship 现有 loop / phase brief，不新增 workflow runner、agent registry 或调度框架。

### 改动
- `docs/AGENT_PLAYTEST_PROCESS.md` — 新增 tracked 项目流程文档，定义 lead orchestrator、implementer、code reviewer、BB player 四条 lane；主 agent 保留上下文用于规划、派发、验收和下一轮规划，具体文件映射、局部实现、测试失败诊断、试玩和 review 优先派发给子 agent。
- `.ship/loop-infra/phase-briefs/review-brief.md` — 增加 review packet 和 reviewer 输出契约，固定 `REQUEST_CHANGES / COMMENT / APPROVE`、scope table、findings、next actions、rerun checks。
- `.ship/loop-infra/phase-briefs/market-brief.md` — 增加 `BB player` persona，用代表性 Direct / Crew / Story 路径检查角色还原、关系张力、语言、GIF、安全拒绝和剧情节奏。
- `.ship/loop-protocol.md` — Review 与 Market Simulation 阶段指向上述两个现有 phase brief。

### 验证
- 实际派发两个只读并行 agent：code reviewer lane 与 BB player lane。
- 子 agent 反馈已合并；未引入新运行时代码或新依赖。
- `git diff --check` — passed

## 2026-07-06 Computer Use playthrough fixes ✅

### 背景
- 使用 Computer Use 在 Chrome 里完整走了一遍本地 `127.0.0.1:5173`：Landing → Story setup → Start Story → Chat → 发送消息 → 回到 Story。
- 目标不是只看静态页面，而是用真实前后端链路发现可玩性问题并修掉。

### 发现的问题
- 英文 UI 下，Walter 新回复仍然输出中文；根因是后端 direct chat 虽然接收了 `language`，但角色 prompt 没有强制目标语言，中文 `voiceExample` 会把模型拉回中文。
- Story 创建后直接展示完整 7-beat outline，提前剧透后续剧情。
- Story setup 初始卡片被伪元素撑成过大的空玻璃面板，视觉焦点弱。
- Chat composer 的固定按钮宽度会让 `Thinking…` 状态显得拥挤。

### 改动
- `backend/agents/director.py` — direct / crew chat prompt 明确写入 `Reply language: English/Simplified Chinese only`；voice example 只作为语气参考，不复制其语言。
- `backend/tests/test_director_bugfixes.py` — 新增跨语言 voice example 的 direct-chat 语言控制回归测试。
- `src/App.tsx` — Story Outline 改为玩家可见的非剧透摘要，只显示 beat 数量；完整 outline 仍保留给内部剧情上下文。
- `src/App.css` — Story setup 改为紧凑居中卡片；composer 按钮改为内容宽度并设最小尺寸。

### 验证
- Computer Use 浏览器复测：英文 UI 下新发消息返回英文；Story Outline 只显示 `7 story beats planned`；Story setup 初始卡片布局正常；`Thinking…` 按钮不再挤压。
- `cd backend && uv run pytest` — 119 passed, 1 existing StarletteDeprecationWarning
- `npm run lint` — passed
- `npm test` — 47 passed
- `npm run build` — passed
- `git diff --check` — passed

## 2026-07-06 Visual QA follow-up polish ✅

### 背景
- 当前工作树已经在推进 landing / story 视觉改版。
- 在不覆盖现有未提交视觉改动的前提下，继续收口 Visual QA 剩余的 P1 问题。

### 改动
- `src/App.tsx` — 给主 `app-shell` 加 `lang` 标记；把聊天区 `typing/error/composer` 收拢到单个 `chat-footer`，避免短屏下输入区被挤压。
- `src/App.css` — 中文会话下放宽 `chat/story` 正文行高；移动端 sidebar 改为有上限的内部滚动；手机断点下 composer 改为单列；补 Firefox `scrollbar-width` / `scrollbar-color` 到 sidebar。
- `src/styles/tokens.css` — 新增 `--line-height-cjk: 1.7`。
- `.ship/tasks/breaking-bad-roleplay-qa-1-ui-2-a-b-qa-3/dev-context.md` — 记录本轮测试命令、模式参考和单波次实现范围。

### 验证
- `npm run lint` — passed
- `npm test` — 47 passed
- `npm run build` — passed
- `git diff --check` — passed

## 2026-07-03 Visual QA audit + P0 fixes + E2E infrastructure ✅

### 背景
- Ship QA task: `breaking-bad-roleplay-qa-1-ui-2-a-b-qa-3`，全量视觉 QA + 游戏测试方法论调研。
- 输出 `visual-qa-report.md`（14 个发现，P0/P1/P2 分级）和 `testing-methodology.md`（4 种测试方法 + 3 周路线图）。

### 发现的 P0 问题
1. `.msg--char` 类在 App.css 中无对应规则，角色消息缺少左对齐的 avatar + body grid 布局。
2. `BeatControls` 组件 destructuring 了 `language` prop，但 `BeatControlsProps` 接口未声明，属于死代码。
3. `VoicePlayer` 的禁用态和按钮文案硬编码英文，中文环境下显示 English fallback。

### 修复
- `src/App.css` — 新增 `.msg--char .msg-avatar` / `.msg--char .msg-body` 规则，与 `.msg--user` 对称布局。
- `src/App.tsx` — 移除 `BeatControls` 中未使用的 `language` 参数。
- `src/components/VoicePlayer.tsx` — 新增 `unavailableText` prop，默认按 `language` 自动选择中文/英文文案；新增 `fallbackLabel` 逻辑。

### E2E 测试基础设施修复
- 3 个 E2E spec 文件共 22 个测试失败，全部卡在 landing screen 未 bypass：
  - `waitForLoadState('networkidle')` — 在 SPA + 热重载环境下超时，改成 `domcontentloaded`。
  - `seedStorage` 后缺少 `abq_enteredWorld: true`，导致页面仍显示 landing screen 而非聊天界面。
  - `gotoFresh` 缺少 landing screen bypass 步骤。
  - FC-1 中 `#llmProvider` selector 在 Loop 3 已从 UI 移除，改为注释说明。
- 以上均为预存问题（clean baseline 上也失败），非本轮 P0 修复引入的回归。

### 交付物
- `.ship/tasks/breaking-bad-roleplay-qa-1-ui-2-a-b-qa-3/product/visual-qa-report.md`
- `.ship/tasks/breaking-bad-roleplay-qa-1-ui-2-a-b-qa-3/product/testing-methodology.md`

### 验证
- `npx tsc --noEmit` — 0 errors
- `npx tsx --test` — 32 passed, 0 failed
- E2E: 22 个预存失败（landing screen bypass 问题），1 passed，1 skipped

### Commits
- `452495f` fix: P0 visual QA — .msg--char styles, VoicePlayer i18n, BeatControls props
- `5329381` fix: E2E tests — bypass landing screen, use domcontentloaded, update model selector

---

## 2026-07-02 Docker VM deployment + bb.yishuziyu.cn ✅

### 背景
- Supabase Edge Functions 迁移完成了设计阶段，但当前最短可玩路径是保留 FastAPI，直接部署到现有 Docker VM。
- 服务器公网 IP 变更为 `121.89.90.68`，仍在运行且资源足够：Docker 26.1，容器端口 8080 可用。
- 用户希望新项目域名使用 `bb.yishuziyu.cn`，不要影响已有 `gun.yishuziyu.cn` 项目。

### 改动
- `.dockerignore` — 忽略 `.DS_Store` / `._*` / `**/._*`，避免 macOS AppleDouble 文件进入 Docker build context 后让 Alembic 读到 null bytes。
- `Dockerfile` — npm 使用 `registry.npmmirror.com`，pip 使用清华镜像源，解决国内 VM 构建时 npm/PyPI 下载超时；启动命令仍为 `alembic upgrade head && python3 start.py`。
- `backend/alembic/env.py` — Alembic online migration 改为直接 `create_engine(URL)`，绕过 `configparser`，避免数据库密码中的 URL 编码字符被当成 `%` 插值。
- `backend/db/url.py` — 保持密码特殊字符的 percent-encoding；不再把 `%40` 解码回裸 `@`。
- `backend/alembic/versions/a1b2c3d4e5f6_add_session_current_mode.py` — 新增 `sessions.current_mode`，修复线上 `/api/session/create` 因缺列导致的 500。
- `backend/agents/provider.py` — StepFun HTTP 错误时，如果配置了 MiniMax key，自动 fallback 到 `MiniMax-M3`；线上 StepFun 当前返回 402 quota exceeded，MiniMax fallback 可继续生成剧情。
- `src/App.tsx` / `src/App.css` — 修复 landing 点击后又被 auto-play 状态重置的问题；新增 `hasEnteredWorld`，点击 `ENTER THE WORLD` 后进入 Story UI 并触发默认剧情；首访语言跟随浏览器偏好并保证运行时语言非空。

### 服务器与域名
- 应用目录：`/opt/breaking-bad-roleplay`
- 容器：`bb-roleplay`
- 端口：`0.0.0.0:8080 -> 8080`
- 公网入口：
  - `https://bb.yishuziyu.cn/`
  - `http://121.89.90.68/`
- Nginx：
  - `/etc/nginx/conf.d/bb-roleplay.conf` — `bb.yishuziyu.cn` 80/443 反代到 `127.0.0.1:8080`
  - `/etc/nginx/conf.d/red-herring-ip-api.conf` — IP 访问 `121.89.90.68` 反代到本项目
  - `gun.yishuziyu.cn` 的正式域名配置仍在 `/etc/nginx/conf.d/red-herring.conf`，未作为本项目域名使用
- TLS：
  - Let’s Encrypt certificate: `/etc/letsencrypt/live/bb.yishuziyu.cn/`
  - 到期时间：2026-09-30 14:49:59 UTC
  - 当前证书通过手动 DNS-01 签发，后续需要在到期前续签，或接入阿里云 DNS API hook 自动续签。
- DNS：
  - 阿里云 DNS 已添加 `bb.yishuziyu.cn -> 121.89.90.68`
  - HTTP 域名访问可能被阿里云 ICP 拦截；HTTPS 已验证可用。

### 数据库与 Provider
- Supabase direct DB hostname 只给 IPv6，当前 VM 无可用 IPv6 出口，所以线上改用 Supabase pooler。
- pooler 连接采用 project-ref 用户名形态，密码必须 URL encode；文档和提交中不记录密码。
- StepFun key 可配置，但当前线上请求命中 402 quota exceeded；MiniMax key 存在时自动 fallback，保证故事模式可玩。

### 验证
- `npm run build` — passed
- `cd backend && ./.venv/bin/pytest tests/test_provider_parsing.py tests/test_routes.py tests/test_db_url.py` — 27 passed, 1 existing StarletteDeprecationWarning
- `git diff --check` — passed
- Playwright public smoke on `https://bb.yishuziyu.cn/` — landing loads, `ENTER THE WORLD` click enters Story UI
- Server check — `bb-roleplay` container running, Nginx routes `bb.yishuziyu.cn` to `127.0.0.1:8080`

### 已知后续
- Docker public build logs still warn that `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are not injected; guest story mode works, but authenticated cloud sync needs build-time Vite env vars if this VM deployment becomes the long-term path.
- Let’s Encrypt DNS-01 certificate is manual-renewal unless an Aliyun DNS automation hook is added.
- Server-side Nginx and cert setup are documented here but not yet codified as IaC.

---

## 2026-07-01 Privacy model + encrypted cloud profile ✅

### 背景
- 用户追问“怎么确保开发者不会看到用户隐私”。
- 结论：RLS 只能防普通用户互看，不能防持有 service role / DB admin 的开发者读取明文。
- 产品承诺必须分清：用户隔离、日志克制、云端密文、运行时明文处理这四个层次。

### 改动
- `docs/PRIVACY_MODEL.md` — 新增隐私模型，明确当前承诺、不能承诺的边界、日志红线和已知缺口。
- `src/lib/privacyVault.ts` — 新增客户端隐私库：
  - email/password 登录后派生 AES-GCM key；
  - 本机保存派生密钥用于 session 恢复；
  - 云端密文 envelope 前缀为 `abqenc:v1:`。
- `src/hooks/useAuth.ts` — sign-in/sign-up 成功后派生并保存隐私密钥；sign-out 清理本机隐私密钥。
- `src/lib/supabasePersistence.ts` — 新增 private persistence：
  - `persistPrivateChatMessage`
  - `persistPrivateChatMessages`
  - `persistPrivateCharacterMemory`
  - load 路径自动解密新 envelope，并兼容旧明文数据。
- `src/App.tsx` — 云同步只在隐私密钥可用时运行；如果已有 session 但密钥缺失，进入 `privacy-locked`，不继续上传明文。
- `src/components/AuthSection.tsx` — 新增 `privacy-locked` 用户提示。
- `tests/privacy-guard.spec.ts` — 禁止生产日志记录 raw userInput/history/memory/prompt/response 等敏感字段。
- `src/lib/privacyVault.test.ts` / `src/lib/supabasePersistence.test.ts` — 覆盖加密、解密、错误密钥失败、云端写入不是明文。
- Code Wiki 更新 Supabase 字段说明：`message` / `summary` / `key_facts` 新写入为客户端加密 envelope。

### 隐私边界
- 已做到：Supabase 中新的聊天与角色记忆不再以明文保存。
- 已验证：RLS 真实项目验收通过，普通用户无法读写他人行。
- 仍不能承诺：后端和 LLM provider 在生成时完全不处理明文；这是当前 AI 回复链路的必然条件。
- 已知缺口：FastAPI Story/session 表尚未客户端加密；密码变更后的旧密文重加密流程尚未实现。

### 验证
- `npm test` — 36 passed
- `AUTH_E2E=1 ... npx playwright test tests/e2e/auth-profile.spec.ts --workers=1` — 1 passed，验证云端回填为 `abqenc:v1:` 密文
- `npm run verify:rls` — live Supabase RLS passed
- `npm run lint`
- `npm run build`
- `npx playwright test` — 23 passed, 1 skipped
- `cd backend && uv run pytest` — 99 passed, 1 existing StarletteDeprecationWarning

---

## 2026-06-30 Lint baseline + E2E guardrail ✅

### 改动
- 修复前端 ESLint 基线：去掉 render/effect 同步 setState、空 catch、`any` 测试类型逃逸。
- `GifCard` / `Silhouette` 改为按失败资源记录 fallback，避免为重置状态额外触发 effect。
- `useAuth` 稳定 Supabase client 生命周期，保持未配置 Supabase 时的匿名可用路径。
- `first-immersive` AC-8 测试收窄到“每条 Crew debate 回复各自有 GIF”，避免把开场消息 GIF 算入辩论回复数量。

### 验证
- `npm run lint`
- `npm test` — 21 passed
- `npm run build`
- `uv run pytest` — 98 passed, 1 existing StarletteDeprecationWarning
- `npm run e2e` — 19 passed

---

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
