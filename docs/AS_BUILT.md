# 现状地图（as-built）

写于 2026-09-15。对不上写「打架」或「未读」。下文分两块：已经拍板的产品决定，和仓库里现在怎么跑。不要把「以后归在剧情下面」读成代码已经接进去了。

## 已经确认的产品决定

从现役索尔门接着做：先打招呼，再选 剧情 / 单聊 / 群聊。不是再开一场首页竞赛。

旧夜路页、黄色「开始这一夜」门、杰西插画封面：不是首页候选项。画可以以后再用，不要把那些页恢复成默认入口。

六回合以后归在剧情下面，不作为第四个顶层入口。不要把它叫成未加限定的「正式局」。

颜色：眼下保持现役门。以后如果上夜色/黄绿，同一改动里更新 [COLOR_SCIENCE.md](COLOR_SCIENCE.md)。不要让文档还要求烟草色、代码却用危化绿。

「现在是什么」以本文件为索引。[CLAUDE.md](../CLAUDE.md)、[README.md](../README.md)、[HANDOFF_2026-09-14.md](HANDOFF_2026-09-14.md) 指向这里，不当平行「当前」。

## 当前代码事实

只记仓库里现在是什么。不写「应该是」。

六回合已实现，目前尚未接入剧情，只能通过 `?night=1` 从 `src/main.tsx` 的 `nightOpen` 顶层独立进入。`App` 不读这个参数。默认无参打开是索尔门。

---

## 1. 无参数打开，第一屏是什么

条件：地址没有 `night=1`、没有 `home=preview`、本地没有「已进入世界」。

| 步 | 条件 | 挂什么 | 证据 |
|---|---|---|---|
| 壳 | `nightOpen` → 六回合界面；否则 → App | `src/main.tsx` `nightOpen` | 同文件 `import App`、`import GameScreen`、`import './styles/temp-apple-skin.css'` |
| App | `homePreviewOpen`（`home === 'preview'`） | 插画封面 | `src/App.tsx` `homePreviewOpen`、`<HomePreview>` |
| App | `!hasEnteredWorld` | 索尔开场门 | `src/App.tsx` `hasEnteredWorld`、`<ColdOpenLanding>` |
| 门文案 | 中文第一访 | 索尔·古德曼 / 「进来坐。」 | `src/components/coldOpenCopy.ts` `INTRO_COPY.zh`；`src/components/ColdOpenLanding.test.ts` `'first visit is a game intro, not a mode menu'` |
| 门组件 | 类名 `cold-open`，不是 `landing-screen` | `src/components/ColdOpenLanding.tsx` 根节点 `className="cold-open"` |

本机无查询、`:5176` 第一屏截图：`.tmp-play/first-paint-noquery.png`（2026-09-15）。画面是沙漠 + 索尔说话 + Sit down（浏览器语言走英文：`src/App.tsx` `defaultLanguage`）。不是插画封面，不是六回合局。

Playwright 门用例默认口是 `:5173`（`tests/e2e/cold-open-drama.spec.ts` `BASE_URL`），本仓库 Vite 口是 `5176`（`vite.config.ts` `server.port`）。**打架**（见 §5）。

---

## 2. 当前可达路径

```text
打开网站
  ├─ ?night=1     → 六回合界面（App 不读这个参数；main.tsx `nightOpen` 顶层分叉）
  └─ 否则 App
        ├─ ?home=preview → 插画封面（只认查询参数）
        └─ 否则
              ├─ 本地未进入世界 → 索尔门（剧情 / 单聊 / 群聊）
              └─ 已进入 → 本地 surface：story / direct / crew
```

| 路径 | 怎么进 | 打哪组接口 | 现役？ |
|---|---|---|---|
| 剧情 | 门上选剧情（`onStart` → `handleColdOpenStart`） | 先场面卡，点开始才 `POST /api/session/create` + `GET /api/session/{id}/stream`；停拍后 `POST /api/session/{id}/action` | **现役默认门** |
| 单聊 | 门上 `onEnterDirect`，或 `?surface=direct` | 同一条 `POST /api/chat`，`mode=direct` | **现役** |
| 群聊 | 门上 `onEnterCrew`，或 `?surface=crew` | 同一条 `POST /api/chat`，`mode=crew` | **现役** |
| 六回合 | 只靠 `?night=1`（`nightOpen`） | `POST /api/game/start` 等 `/api/game/*` | **查询参数 / 实验室**；不是第四扇顶部门 |

进法证据：

- 门三个按钮：`src/App.tsx` `<ColdOpenLanding>` 的 `onStart={handleColdOpenStart}`、`onEnterDirect`、`onEnterCrew`（单聊/群聊直接进）；剧情 `handleColdOpenStart` 只抬幕、不立刻开流。
- `?surface=` 只认 `direct` / `crew`：`src/lib/playEntry.ts` `playSurfaceFromSearch`；`src/lib/playEntry.test.ts` `'?surface=direct and ?surface=crew skip Story cold-open'`。写入 `enteredWorld`：同文件 `'writes enteredWorld so Direct/Crew are reachable without a Story run'`。App 启动就跑：`src/App.tsx` `applyPlaySurfaceToStorage`。
- `?home=preview` 不写 surface：`playSurfaceFromSearch('?home=preview')` 返回 `null`。
- `surface` 默认 `'story'`，派生 `view`/`mode`：`src/App.tsx` `usePersistedState<Surface>('surface', 'story')`。
- App 禁止引用「开始这一夜」：`src/lib/appPlayQa.wire.test.ts` `doesNotMatch(app, /NightStartCta/)`。按钮组件只被六回合测试引用：`src/features/game/GameScreen.test.ts` 对 `NightStartCta` 的 import，以及 `'night kernel keeps its own entry at ?night=1'`。
- `App` 不读 `night`：`src/main.tsx` `nightOpen` 在进 App 之前就分叉。

### 剧情（现役）

1. 门选剧情 → `handleColdOpenStart`：`setCurtainRaised(false)` + `setSurface('story')` + `setHasEnteredWorld(true)`。
2. 场面卡挡住 SSE：`holdsSceneCurtain`（`src/lib/storyScene.ts`）；`showSceneBill`（`src/App.tsx`）。
3. 点场面卡按钮 → `handleRaiseCurtain` → `beginStoryStream`（`src/App.tsx`）。
4. `startStory`（`src/hooks/useStoryStream.ts`）：`POST /api/session/create` 再挂 `connectStream` → `GET /api/session/{id}/stream`（`buildStreamQuery`）。
5. 流里跑 `DirectorAgent.process_next_beat`（`backend/api/routes.py` `stream_session`）。
6. 决策条只在 `beat_paused`：`src/App.tsx` `<DramaDecisionBar>`。继续 = `continue`；点建议/自由输入 = `redirect`。

**打架**：注释写「等开演」（`src/App.tsx` `pendingStoryPrompt` 注释、`handleColdOpenStart` 内「SSE waits for 开演」）；按钮文案是「开始故事」（`src/lib/storyScene.ts` `buildStorySceneBill` 的 `startLabel`）；场面卡测试禁止出现「开演」（`src/components/StorySceneBillboard.test.ts` `'场面卡 shows place, crisis, and on-stage faces'`）。同一条路径，三个名字。

连线抽屉 / 额度：门上和进世界后都挂 `ConnectionSheet`（`src/App.tsx`）；额度 pill 在剧情顶栏 `story-hud__credits`。未把每一条额度分支逐行读完 → 细节 **未读**。

### 单聊 / 群聊（现役）

发送：`src/App.tsx` `handleSend` → `POST /api/chat`。后端 `chat()` 只收 `direct`/`crew`（`backend/api/routes.py` `ChatRequest.mode`）→ `DirectorAgent.handle_chat_message`（`backend/agents/director.py`）。

- 单聊：`bubbleFromDirectPayload`（`src/lib/directChatReply.ts`）。
- 群聊：`bubblesFromCrewPayload`（`src/App.tsx` `handleSend`）。

工作区未提交的瘦栈 / 记忆 / 开场白：见 §6。不要当成已发布正门。

### 六回合（查询参数）

- 入口：`src/main.tsx` `nightOpen`；`GameScreen` → `useGameRun(1)`（`src/features/game/GameScreen.tsx`）。
- 钩子只 import `./api.ts`，不 import `./kernel`，不含 `createLocalGame`：`src/features/game/useGameRun.ts`；`GameScreen.test.ts` `'play path talks to the night API, not the in-browser kernel'`。
- `gameClient.ts` 在 `src/` 里零引用（全库搜 `from '...gameClient'` 为空）。
- HTTP：`backend/api/game_routes.py`（`start_game` 等六个 `/game/*`）；挂进主路由 `backend/api/routes.py` `router.include_router(game_router)`。
- 开局：`start_game` → `GameService.start` → `start_run`（`game_routes.py`；`backend/game/service.py`；`backend/game/kernel.py`）。

---

## 3. 模块图

```text
浏览器
  main.tsx
    ├─ nightOpen → GameScreen → useGameRun → api.ts → /api/game/*
    │                                              → game_routes.start_game
    │                                              → game.service → kernel.start_run
    └─ 否则 App
          ├─ homePreviewOpen → HomePreview
          ├─ 未进世界 → ColdOpenLanding
          └─ 已进世界
                ├─ story → useStoryStream.startStory / connectStream → /api/session/create|stream|action
                │                         → director.process_next_beat
                └─ direct/crew → POST /api/chat
                                  → director.handle_chat_message
                                    ├─ direct → _handle_direct_chat
                                    └─ crew   → _handle_crew_chat
```

HTTP 一共 26 条（`@router` 装饰器数）：

- `backend/api/routes.py`：health、connections×5、quota、tts×2、session×5、chat、agent×5 → 20
- `backend/api/game_routes.py`：game×6
- 总挂口：`backend/main.py` `app.include_router(api_router, prefix="/api")` 只挂一套 `/api`

`/api/game/*`、`/api/agent/*`：只服务六回合 / 实验室。`src/App.tsx` `showAgentLab`：`?lab=1` 或路径含 `/lab` 才出实验室。

`DirectorAgent.process()`（`backend/agents/director.py`）：`backend/api/` 零调用。出现在 `backend/tests/test_loop4_p0_actions.py`、`test_mckee_story.py`、`test_director_bugfixes.py` 等。SSE 测试写明不得走它（`backend/tests/test_sse_stream.py` `legacy_process_must_not_run`）。

角色：

| 层 | 名单 | 证据 |
|---|---|---|
| UI 可选 | 8 个，含 Marie | `src/App.tsx` `CharacterId`、`DISPLAY_NAME_TO_ID`、`characters` |
| CONTEXT 表 | 7 个，无 Marie | `CONTEXT.md` 角色表 |
| 导演可演 | 7 个，无 Marie | `director.py` `CHARACTER_AGENTS` |
| 前端 id 映射 | 7 个，无 marie | `director.py` `FRONTEND_TO_BACKEND_ID` |
| 未知 id | 落到 Walter White | `director.py` `handle_chat_message` 回落到 `CHARACTER_AGENTS["Walter White"]` |
| Marie 模块 | 文件在，未进导演表 | `backend/agents/characters/marie.py` `MARIE_SYSTEM_PROMPT` / `MarieSchrader`；`__init__.py` `__all__` 含 `MarieSchrader` |

**打架**：界面有 Marie；导演把不认识的 id 当成沃尔特；CONTEXT / CLAUDE 仍写 7 人。

安全（现役调用，未逐条读完规则表）：`turn_runtime.py` `generate_accepted_turn` 走 `should_publish_turn` + `howto_deflection_line`。**规则全文未读**。

数据：

- 剧情表：`sessions` / `messages` / `character_states` / `character_dossiers`（`backend/alembic/versions/f1a2b3c4d5e6_initial_schema.py`；模型 `Session` / `Message` / `CharacterState` / `CharacterDossier`）
- 额度 / 自备密钥表：`d4e5f6a7b8c9_add_byok_and_quota_tables.py`；模型 `backend/db/models.py` `QuotaUsage` / `QuotaUsageGlobal`
- 六回合表：`GameRun` 等（`backend/game/models.py`；迁移 `g7h8i9j0k1l2`）
- 游客：`src/lib/guestId.ts` `getOrCreateGuestId`；额度钩子带 `guest_id`（`src/hooks/useQuota.ts` `refresh`）
- 登录：`src/hooks/useAuth.ts`（Supabase）
- 线路密钥：内存绑定（`backend/api/routes.py` bind 路由 docstring「RAM bind」）

结构图：本会话 `codegraph status` = 未初始化。上一轮记录 5356 节点 — **本会话未复核**。调用关系以上面的符号名为准，不以图为准。

---

## 4. 死件清单

判定：零产品引用，或测试禁止引用。不删。

| 件 | 判定 | 证据 |
|---|---|---|
| `NightStartCta` | 死（对 App） | 产品 import 只有 `GameScreen.test.ts`；`appPlayQa.wire.test.ts` 禁止 App 出现该名 |
| `NightStartCta.css` | 死 | 全库零 `NightStartCta.css` 字符串 |
| `ScenePanel` | 死 | 唯一定义 `src/features/game/components/ScenePanel.tsx` `ScenePanel`；零消费者 |
| `gameClient.ts` / 浏览器内核 | 默认玩法不用 | `useGameRun.ts` 只引 `api.ts`；`GameScreen.test.ts` `'play path talks to the night API, not the in-browser kernel'` |
| `director.process` | HTTP 死；测试活 | `backend/api/` 零命中；测试见 §3 |
| `.landing-screen` | TSX 死，CSS 仍在 | `src/**/*.tsx` 零 `className`；`src/App.css` 仍有 `.landing-screen` 规则 |
| `.onboard` | 同上 | `src/App.css` `.onboard`；TSX 零 className |
| `.story-outline` | 同上 | `src/App.css` `.story-outline`；TSX 零 className |
| `.story-scene-card` | 同上 | `src/App.css` `.story-scene-card`；TSX 零 className |
| `.schema-pill` | 同上 | `src/App.css` `.schema-pill`；TSX 零 className |

**打架**：旧 E2E 仍点 `.landing-screen`（`tests/e2e/interaction-qa.spec.ts`、`tests/e2e/ix-qa.spec.ts`）。现役门类名是 `cold-open`（`ColdOpenLanding.tsx`；`tests/e2e/cold-open-drama.spec.ts` `gotoDoor`）。

两份 `one_night.json`：`src/features/game/one_night.json` 与 `backend/game/data/one_night.json`，`cmp` 相同（各 9013 字节）。不是死件，是双份同一份规则表。

---

## 5. 文档打架

不选赢家。两套「当前」并排。

| 题目 | 甲方 | 乙方 |
|---|---|---|
| 产品是什么 | 本文件锁定：索尔门 → 剧情 / 单聊 / 群聊。CLAUDE / README / CONTEXT / HANDOFF 开口已指向本文件 | `docs/NIGHT_KERNEL.md` 开头仍写正式局是一个晚上、你是沃尔特；Direct / Crew 次级、本轮不扩。`docs/PLANNING.md` 仍绑定三模式。HANDOFF 开口、入口表与 §10 已改：六回合是独立实验入口，不再把 NIGHT_KERNEL 写成当前锁定工单 |
| 先读哪份 | 本文件由 CLAUDE 顶行、README 开口、HANDOFF「先读」指向 | 已对齐。HANDOFF §8 阅读顺序仍把本文件排在后面 |
| 本地端口 | `README.md`、`CLAUDE.md`、`vite.config.ts` `server.port`：5176 | Playwright 默认仍 5173（`cold-open-drama.spec.ts` `BASE_URL`） |
| 颜色 | `docs/COLOR_SCIENCE.md`：禁止 iOS 冷灰；`#292929` 不当世界色 | `src/main.tsx` 现役叠 `temp-apple-skin.css`。该皮肤自己写 ink greys 且 `--ink-1: #292929`，同文件 cold-open 段又写 Not iOS grey-white |
| Marie | UI 8 人（`src/App.tsx` `CharacterId`） | CONTEXT / CLAUDE / `CHARACTER_AGENTS` 写 7 人（见 §3） |
| README 接口表 | `README.md` API 表：`/api/session`、`/api/events/{session_id}` | 现役是 `/api/session/create`（`create_session`）与 `/api/session/{id}/stream`（`stream_session`） |

`docs/` 根目录归类（只读了标题/开头，不当规格）：

| 状态 | 文件 |
|---|---|
| 现役约束 | `OPS_RUNBOOK.md`（`PLANNING.md` What still binds）、`COLOR_SCIENCE.md`（`CLAUDE.md`）、`architecture/layering.md`（自称 Story 分层）、`decisions/DEC-0002`…`DEC-0006`（`PLANNING.md`）、`PRIVACY_MODEL.md`、`FREE_TIER_SECURITY.md` |
| 与代码打架的「当前」 | `NIGHT_KERNEL.md`、`PLANNING.md` What still binds（仍写三模式；六回合未写入默认入口） |
| 查询参数草稿 | `HOME_PREVIEW.md`：封面未当默认门 |
| 未提交契约 | `DIRECT_CHAT_CONTRACT.md`（工作区新文件，§6） |
| 过期仍放根上 | `HANDOFF_2026-07-02.md`、`PROJECT_INTAKE.md`（已声明归档）、`QA-2026-08-27.md`、`DEVLOG-2026-08-27-ftue-reliability.md`、`NO_MISTAKES_SMOKE.md`、`PRODUCT_SPEC.md`、`GAME_UX_PLAYBOOK.md`、`architecture.md`（2026-06-16）、`DEPLOY_RENDER.md`、`DEC-0001-function-calling.md`、`ARCH-DESIGN-function-calling.md`、`PERFORMANCE_RUNTIME.md`（#66 推迟）、`BLIND_AB_RETROSPECTIVE.md`、`DIFFUSION_MONITORING.md`、`BYOK_BRANDING.md`、`FRIENDS_EARLY_ACCESS.md`、`AGENT_PLAYTEST_PROCESS.md`、`decisions/DEC-0007-gameplay-rebuild.md`（自称未接受） |
| 归档入口 | `archive/plans/README.md`：不当约束读 |
| 指针 | `narrative/README.md`、`specs/README.md`、`code-wiki/README.md` |

---

## 6. 未提交工作区

下面不是 HEAD 正门。`git status` / `git diff --stat HEAD` 于 2026-09-15。

未跟踪（单聊瘦栈 / 记忆 / 开场）：

- `backend/agents/direct_chat_craft.py`
- `backend/agents/direct_chat_stack.py`
- `backend/agents/identity_guard.py`
- `backend/eval/direct_chat_matrix.py`
- `backend/tests/test_direct_chat_craft.py`
- `backend/tests/test_direct_chat_stack.py`
- `backend/tests/test_identity_guard.py`
- `docs/DIRECT_CHAT_CONTRACT.md`
- `src/lib/directDurableMemory.ts` + `.test.ts`
- `src/lib/directOpeners.ts` + `.test.ts`

已改未提交（导演 / 回合 / 路由 / App 已引用其中一部分）：

- `backend/agents/characters/base.py`、`jesse.py`
- `backend/agents/director.py`（`_handle_direct_chat` 已 import `direct_chat_stack`）
- `backend/agents/turn_runtime.py`
- `backend/api/routes.py`（`ChatRequest.durableMemory`）
- `backend/tests/test_direct_chat_memory.py`
- `src/App.tsx`（`pickDirectOpener` / `formatDurableMemoryForWire`）
- `src/hooks/useCharacterMemory.ts`
- `src/lib/directChatReply.ts` + 测试
- `src/lib/openerLanguage.ts`
- `src/lib/appPlayQa.wire.test.ts`
- `src/App.css`、`src/components/ChatRefresh.css`、`src/styles/temp-apple-skin.css`
- `src/components/VoicePlayer.tsx`
- `tests/e2e/sse-story.spec.ts`

杂项未跟踪（不约束产品）：`.statamcp/`、`.tmp-play/`。

HEAD 上的单聊仍走 `POST /api/chat` → `handle_chat_message`。瘦栈、五类记忆、开场库只在工作区。

---

## 7. 未读剩余

- 本会话结构图未初始化，5356 节点数未复核。
- `materials/`、`.ship`、历史循环、本地评测 JSON：不约束产品，未逐字读。
- `docs/archive/`、`docs/code-wiki/`、`docs/agent-harness/`：只登记，未当规格读。
- §5「过期仍放根上」各文件：只读了标题/开头。
- 额度每一条分支、线路存储实现、发布门禁 / how-to 规则全文、Crew 独立采样细节：未打穿。
- 线上 VM 此刻默认门是否与本机一致：本会话未打开生产站。
- `NightStartCta` 最后一次被默认路径引用的 git 历史：未查。
