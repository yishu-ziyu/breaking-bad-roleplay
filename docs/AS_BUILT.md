# 现状地图（as-built）

写于 2026-09-15。只记仓库里现在是什么。不写「应该是」。对不上写「打架」或「未读」。

## 已锁定（2026-09-15）

从现役索尔门接着做：先打招呼，再选 剧情 / 单聊 / 群聊。不是再开一场首页竞赛。

旧夜路页、黄色「开始这一夜」门、杰西插画封面：不是首页候选项。画可以以后再用，不要把那些页恢复成默认入口。

六回合夜晚是剧情下面的内容，不是第四扇顶部门。今天：已实现，只走 `?night=1`，不在默认剧情路径上。不要把它叫成未加限定的「正式局」。

颜色：眼下保持现役门。以后如果上夜色/黄绿，同一改动里更新 [COLOR_SCIENCE.md](COLOR_SCIENCE.md)。不要让文档还要求烟草色、代码却用危化绿。

「现在是什么」以本文件为索引。[CLAUDE.md](../CLAUDE.md)、[README.md](../README.md)、[HANDOFF_2026-09-14.md](HANDOFF_2026-09-14.md) 指向这里，不当平行「当前」。

---

## 1. 无参数打开，第一屏是什么

条件：地址没有 `night=1`、没有 `home=preview`、本地没有「已进入世界」。

| 步 | 条件 | 挂什么 | 证据 |
|---|---|---|---|
| 壳 | `night === '1'` → 六回合界面；否则 → App | `src/main.tsx` 12–16 | 同文件 5、8–10：App 与临时皮肤都挂上 |
| App | `home === 'preview'` | 插画封面 | `src/App.tsx` 805、1652–1661 |
| App | 未进入世界 | 索尔开场门 | `src/App.tsx` 760、1683–1686 |
| 门文案 | 中文第一访 | 索尔·古德曼 / 「进来坐。」 | `src/components/coldOpenCopy.ts` 170–173；`src/components/ColdOpenLanding.test.ts` 27–36 |
| 门组件 | 类名 `cold-open`，不是 `landing-screen` | `src/components/ColdOpenLanding.tsx` 100–101 |

本机无查询、`:5176` 第一屏截图：`.tmp-play/first-paint-noquery.png`（2026-09-15）。画面是沙漠 + 索尔说话 + Sit down（浏览器语言走英文：`src/App.tsx` 751–753）。不是插画封面，不是六回合局。

Playwright 门用例默认口是 `:5173`（`tests/e2e/cold-open-drama.spec.ts` 14），本仓库 Vite 口是 `5176`（`vite.config.ts` 15–16）。**打架**（见 §5）。

---

## 2. 四条玩法

```text
打开网站
  ├─ ?night=1     → 六回合界面（App 不读这个参数）
  └─ 否则 App
        ├─ ?home=preview → 插画封面（只认查询参数）
        └─ 否则
              ├─ 本地未进入世界 → 索尔门（剧情 / 单聊 / 群聊）
              └─ 已进入 → 本地 surface：story / direct / crew
```

| 玩法 | 怎么进 | 打哪组接口 | 现役？ |
|---|---|---|---|
| 剧情 | 门上选剧情（`onStart` → `handleColdOpenStart`） | 先场面卡，点开始才 `POST /api/session/create` + `GET /api/session/{id}/stream`；停拍后 `POST /api/session/{id}/action` | **现役默认门** |
| 单聊 | 门上 `onEnterDirect`，或 `?surface=direct` | 同一条 `POST /api/chat`，`mode=direct` | **现役** |
| 群聊 | 门上 `onEnterCrew`，或 `?surface=crew` | 同一条 `POST /api/chat`，`mode=crew` | **现役** |
| 六回合 | 只靠 `?night=1` | `POST /api/game/start` 等 `/api/game/*` | **查询参数 / 实验室** |

进法证据：

- 门三个按钮：`src/App.tsx` 1691–1699（单聊/群聊直接进）；剧情 `1273–1291` 只抬幕、不立刻开流。
- `?surface=` 只认 `direct` / `crew`：`src/lib/playEntry.ts` 5–8；`src/lib/playEntry.test.ts` 6–10。写入 `enteredWorld`：同测试 13–20。App 启动就跑：`src/App.tsx` 742–747。
- `?home=preview` 不写 surface：`playEntry.test.ts` 9。
- `surface` 默认 `story`，派生 `view`/`mode`：`src/App.tsx` 789–791。
- App 禁止引用「开始这一夜」：`src/lib/appPlayQa.wire.test.ts` 25。按钮组件只被六回合测试引用：`src/features/game/GameScreen.test.ts` 10、131–135。
- `App` 不读 `night`：`src/main.tsx` 12–16 在进 App 之前就分叉。

### 剧情（现役）

1. 门选剧情 → `setCurtainRaised(false)` + `setSurface('story')` + 进入世界（`App.tsx` 1284–1291）。
2. 场面卡挡住 SSE：`holdsSceneCurtain`（`src/lib/storyScene.ts` 81–97）；`showSceneBill`（`App.tsx` 1559–1563）。
3. 点场面卡按钮 → `handleRaiseCurtain` → `beginStoryStream`（`App.tsx` 1213–1258、1922–1926）。
4. `startStory`：`POST /api/session/create`（`src/hooks/useStoryStream.ts` 591–599）再挂 `GET /api/session/{id}/stream`（同文件 404）。
5. 流里跑 `director.process_next_beat`（`backend/api/routes.py` 984–990）。
6. 决策条只在 `beat_paused`：`App.tsx` 2062–2097。继续 = `continue`；点建议/自由输入 = `redirect`。

**打架**：注释写「等开演」（`App.tsx` 908、1288）；按钮文案是「开始故事」（`src/lib/storyScene.ts` 74）；场面卡测试禁止出现「开演」（`src/components/StorySceneBillboard.test.ts` 23–25）。同一条路径，三个名字。

连线抽屉 / 额度：门上和进世界后都挂 `ConnectionSheet`（`App.tsx` 1711、1851）；额度 pill 在剧情顶栏（1908–1918）。未把每一条额度分支逐行读完 → 细节 **未读**。

### 单聊 / 群聊（现役）

发送：`App.tsx` 1377–1395 → `POST /api/chat`。后端只收 `direct`/`crew`（`backend/api/routes.py` 1304–1334、1409–1426）→ `director.handle_chat_message`（`backend/agents/director.py` 2510–2535）。

- 单聊：`bubbleFromDirectPayload`（`src/lib/directChatReply.ts` 16–29）。
- 群聊：`bubblesFromCrewPayload`（`App.tsx` 1422–1426）。

工作区未提交的瘦栈 / 记忆 / 开场白：见 §6。不要当成已发布正门。

### 六回合（查询参数）

- 入口：`src/main.tsx` 12–16；`GameScreen` → `useGameRun(1)`（`src/features/game/GameScreen.tsx` 185–186）。
- 钩子只 import `./api.ts`，不 import `./kernel`，不含 `createLocalGame`：`src/features/game/useGameRun.ts` 2；`GameScreen.test.ts` 137–144。
- `gameClient.ts` 在 `src/` 里零引用（全库搜 `from '...gameClient'` 为空）。
- HTTP：`backend/api/game_routes.py` 63–123；挂进主路由 `backend/api/routes.py` 1649–1651。
- 开局：`start_game` → `svc.start` → `start_run`（`game_routes.py` 63–65；`backend/game/service.py` 44）。

---

## 3. 模块图

```text
浏览器
  main.tsx
    ├─ night=1 → GameScreen → useGameRun → api.ts → /api/game/*
    │                                              → game_routes.start_game
    │                                              → game.service → kernel.start_run
    └─ 否则 App
          ├─ home=preview → HomePreview
          ├─ 未进世界 → ColdOpenLanding
          └─ 已进世界
                ├─ story → useStoryStream → /api/session/create|stream|action
                │                         → director.process_next_beat
                └─ direct/crew → POST /api/chat
                                  → director.handle_chat_message
                                    ├─ direct → _handle_direct_chat
                                    └─ crew   → _handle_crew_chat
```

HTTP 一共 26 条（`@router` 装饰器数）：

- `backend/api/routes.py`：health、connections×5、quota、tts×2、session×5、chat、agent×5 → 20
- `backend/api/game_routes.py`：game×6
- 总挂口：`backend/main.py` 151 只挂一套 `/api`

`/api/game/*`、`/api/agent/*`：只服务六回合 / 实验室。`App.tsx` 808–817：`?lab=1` 或路径含 `/lab` 才出实验室。

`director.process()`（`director.py` 616）：`backend/api/` 零调用。出现在 `backend/tests/test_loop4_p0_actions.py`、`test_mckee_story.py`、`test_director_bugfixes.py` 等。SSE 测试写明不得走它（`backend/tests/test_sse_stream.py` 310）。

角色：

| 层 | 名单 | 证据 |
|---|---|---|
| UI 可选 | 8 个，含 Marie | `App.tsx` 74、167–213 |
| CONTEXT 表 | 7 个，无 Marie | `CONTEXT.md` 8–15 |
| 导演可演 | 7 个，无 Marie | `director.py` 518–526 |
| 前端 id 映射 | 7 个，无 marie | `director.py` 324–332 |
| 未知 id | 落到 Walter White | `director.py` 2544–2547 |
| Marie 模块 | 文件在，未进导演表 | `backend/agents/characters/marie.py` 60；`__init__.py` 9、20 |

**打架**：界面有 Marie；导演把不认识的 id 当成沃尔特；CONTEXT / CLAUDE 仍写 7 人。

安全（现役调用，未逐条读完规则表）：`turn_runtime.py` 走 `should_publish_turn` + `howto_deflection_line`（23–27、121、147）。**规则全文未读**。

数据：

- 剧情表：`sessions` / `messages` / `character_states` / `character_dossiers`（`backend/alembic/versions/f1a2b3c4d5e6_initial_schema.py` 3–4、32）
- 额度 / 自备密钥表：`d4e5f6a7b8c9_add_byok_and_quota_tables.py`；模型 `backend/db/models.py` 144–182
- 六回合表：`game_runs` 等（`backend/game/models.py` 19–23；迁移 `g7h8i9j0k1l2`）
- 游客：`src/lib/guestId.ts` 9；额度钩子带 `guest_id`（`src/hooks/useQuota.ts` 51–52）
- 登录：`src/hooks/useAuth.ts`（Supabase）
- 线路密钥：内存绑定（`backend/api/routes.py` 468「RAM bind」）

结构图：本会话 `codegraph status` = 未初始化。上一轮记录 5356 节点 — **本会话未复核**。调用关系以上面的文件行号为准，不以图为准。

---

## 4. 死件清单

判定：零产品引用，或测试禁止引用。不删。

| 件 | 判定 | 证据 |
|---|---|---|
| `NightStartCta` | 死（对 App） | 产品 import 只有 `GameScreen.test.ts` 10；`appPlayQa.wire.test.ts` 25 禁止 App 出现该名 |
| `NightStartCta.css` | 死 | 全库零 `NightStartCta.css` 字符串 |
| `ScenePanel` | 死 | 唯一定义 `src/features/game/components/ScenePanel.tsx` 16；零消费者 |
| `gameClient.ts` / 浏览器内核 | 默认玩法不用 | `useGameRun.ts` 2 只引 `api.ts`；`GameScreen.test.ts` 140–142 |
| `director.process` | HTTP 死；测试活 | `backend/api/` 零命中；测试见 §3 |
| `.landing-screen` | TSX 死，CSS 仍在 | `src/**/*.tsx` 零 `className`；`src/App.css` 26 起仍有规则 |
| `.onboard` | 同上 | `App.css` 5604；TSX 零 className |
| `.story-outline` | 同上 | `App.css` 1007；TSX 零 className |
| `.story-scene-card` | 同上 | `App.css` 1283；TSX 零 className |
| `.schema-pill` | 同上 | `App.css` 2314；TSX 零 className |

**打架**：旧 E2E 仍点 `.landing-screen`（`tests/e2e/interaction-qa.spec.ts` 120、653；`tests/e2e/ix-qa.spec.ts` 118、389）。现役门类名是 `cold-open`（`ColdOpenLanding.tsx` 101；`tests/e2e/cold-open-drama.spec.ts` 34）。

两份 `one_night.json`：`src/features/game/one_night.json` 与 `backend/game/data/one_night.json`，`cmp` 相同（各 9013 字节）。不是死件，是双份同一份规则表。

---

## 5. 文档打架

不选赢家。两套「当前」并排。

| 题目 | 甲方 | 乙方 |
|---|---|---|
| 产品是什么 | 本文件锁定：索尔门 → 剧情 / 单聊 / 群聊。CLAUDE / README / CONTEXT / HANDOFF 开口已指向本文件 | `docs/NIGHT_KERNEL.md` 1–13：仍写正式局是一个晚上、你是沃尔特；Direct / Crew 次级、本轮不扩。`docs/PLANNING.md` 9：仍绑定三模式。`HANDOFF_2026-09-14.md` 后文表格仍写「六回合正式局（M1）」；§10 仍把 NIGHT_KERNEL 当下一张工单 |
| 先读哪份 | 本文件由 CLAUDE 顶行、README 开口、HANDOFF「先读」指向 | 已对齐。HANDOFF §8 阅读顺序仍把本文件排在后面 |
| 本地端口 | `README.md`、`CLAUDE.md`、`vite.config.ts` 15–16：5176 | Playwright 默认仍 5173（`cold-open-drama.spec.ts` 14） |
| 颜色 | `docs/COLOR_SCIENCE.md` 3、29：禁止 iOS 冷灰；`#292929` 不当世界色 | `src/main.tsx` 8–10 现役叠 `temp-apple-skin.css`。该皮肤自己写 ink greys 且 `--ink-1: #292929`（`temp-apple-skin.css` 3、42），同文件 652 又写 Not iOS grey-white |
| Marie | UI 8 人（`App.tsx` 74、213） | CONTEXT / CLAUDE / `CHARACTER_AGENTS` 写 7 人（见 §3） |
| README 接口表 | `README.md` 81–84：`/api/session`、`/api/events/{session_id}` | 现役是 `/api/session/create` 与 `/api/session/{id}/stream`（`routes.py` 649、875） |

`docs/` 根目录归类（只读了标题/开头，不当规格）：

| 状态 | 文件 |
|---|---|
| 现役约束 | `OPS_RUNBOOK.md`（`PLANNING.md` 12）、`COLOR_SCIENCE.md`（`CLAUDE.md` 15）、`architecture/layering.md`（自称 Story 分层）、`decisions/DEC-0002`…`DEC-0006`（`PLANNING.md` 13）、`PRIVACY_MODEL.md`、`FREE_TIER_SECURITY.md` |
| 与代码打架的「当前」 | `NIGHT_KERNEL.md`、`PLANNING.md` 9；HANDOFF 后文入口表 / §10（开口已改，见上表） |
| 查询参数草稿 | `HOME_PREVIEW.md` 12：封面未当默认门 |
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
- `backend/agents/director.py`（`_handle_direct_chat` 已 import `direct_chat_stack`：2571）
- `backend/agents/turn_runtime.py`
- `backend/api/routes.py`（`ChatRequest.durableMemory`：1228、1425）
- `backend/tests/test_direct_chat_memory.py`
- `src/App.tsx`（`pickDirectOpener` / `formatDurableMemoryForWire`：41–50、834、1370）
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
