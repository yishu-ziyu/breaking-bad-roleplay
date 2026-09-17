# 现状地图（as-built）

写于 2026-09-15，更新至 2026-09-18。只记当前工作区现在是什么。不写「应该是」。对不上写「打架」或「未读」。未提交/未部署的改动会明确标注。

## 已锁定（2026-09-17）

当前默认首页是三卡展台：**Story / Direct / Crew 三种模式直接并列**。Direct / Crew 是独立 AI 聊天，Story 才是叙事游戏；不强制串成一个 Game Loop。`55df802` 已把旧「索尔先打招呼再选模式」入口替换为三卡首页；不要因为旧文档或旧 E2E 仍写索尔门而恢复旧入口。

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
| App | 未进入世界 | 三卡玩法展台 | `src/components/ColdOpenLanding.tsx`：Story / Direct / Crew 三张卡 |
| Story | 点「开始故事」 | 先问是否看过原作，再进入场面卡 | `ColdOpenLanding.tsx` 的 `showcase-dialog` + `beginStoryWithTrack` |
| 门组件 | 现役根类名 | `cold-open-showcase` | `src/components/ColdOpenLanding.tsx` |

2026-09-17 Playwright 已按现役三卡入口重新跑通 `cold-open-drama.spec.ts`；旧 `.cold-open` / 「进来坐」断言已移除。

日常开发端口仍是 `5176`。Playwright 默认在隔离的 `5173` 启动同一套
Vite 应用，并通过命令行 `--port` 覆盖配置；需要复用本地开发服务器时可
显式设置 `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5176`。这是测试隔离，不是两套产品。

---

## 2. 三种核心模式与一个实验入口

```text
打开网站
  ├─ ?night=1     → 六回合界面（App 不读这个参数）
  └─ 否则 App
        ├─ ?home=preview → 插画封面（只认查询参数）
        └─ 否则
              ├─ 本地未进入世界 → 三卡展台（剧情 / 单聊 / 群聊）
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

### 剧情（现役；P0 新 runtime 仍在工作区，未部署）

1. 门选剧情 → `setCurtainRaised(false)` + `setSurface('story')` + 进入世界（`App.tsx` 1284–1291）。
2. 场面卡挡住 SSE：`holdsSceneCurtain`（`src/lib/storyScene.ts` 81–97）；`showSceneBill`（`App.tsx` 1559–1563）。
3. 点场面卡按钮 → `handleRaiseCurtain` → `beginStoryStream`（`App.tsx` 1213–1258、1922–1926）。
4. 新建剧情：`POST /api/session/create` 创建 runtime v1 世界快照 + opening command；旧存档仍走 legacy runtime。
5. runtime v1：玩家普通建议/自由输入发送 `action=act + command_id + expected_revision`；模型只解释意图，`scenes/world_state.py` 规则结算物品、位置、说法、承诺等有限状态，不能把模型自由文本直接当事实。
6. `story/service.py` 负责 claim / fencing token / 幂等 request hash / 原子 commit；公开事件先保存再通过 SSE 播放。重连同一 `command_id` 直接回放已保存事件，不重复生成和扣费。
7. 刷新时 `GET /api/session/{id}/state` 恢复已提交事件；若存在 `pending_command_id`，前端自动继续该命令，不要求玩家再提交一次。
8. `redirect` 仍是明确的「改变后续方向」控制，不再承担普通玩家动作；已演出的 manuscript 历史保留。
9. `player_turn`、最终角色表演与 `beat_ready` 使用同一 command outbox 保存（`PUBLIC_FIELDS` 只放行这些公开事件；outline 只留在 session 行，不进 outbox）；直播、断线重连和刷新恢复读取同一份公开事件。回放旧拍不会把当前玩家身份倒退到旧 revision。
10. `/state` 只返回 player view：物品知识名单、未听见的说法、他人私下承诺与内部 trust 不出现在响应中。开放自定义 Story 不注入任意 canon era，但仍由世界规则掌握物理效果。
11. 生成中断线重连：旧 stream 仍持有 generation token 时 `/stream` 返回 409 `turn_in_progress`，前端不建新 command、不重发 action、不重复计费；按 800ms→1.6s→3.2s→5s（上限 6 次）退避，每次先查 `/state`，`pending_command_id` 仍是同一 command 就继续等，已提交就连同一个 command 免费回放 outbox；`beat_ready`/`complete`/`reset`/`stop` 都会清掉重连定时器。超预算给出可操作错误，不无限重连。
12. Action ACK 不确定（网络异常/5xx）：前端用**原 command_id** 查 `/state`——pending 自动接上，committed 从 outbox 恢复并按 `event_id` 去重，服务端确认未收到才用同一 id 自动重发一次。原 command 未确认前不接受不同 action；未确认的玩家台词带 `pending` 标记，确认不存在即从正文删除，不要求玩家重新输入同一句。
13. Stop 语义：`POST /api/session/{id}/action {action:"stop"}` 走 `story/service.py:stop_turn` —— 锁 session、失效 generation token、清 `pending_command_id`、`status="stopped"`。保留此前 committed 的 world snapshot、revision、messages 与 lineage；未提交候选之后再 commit 会被 `claim_lost` 拒绝，也不会被 `/state` 恢复；in-flight 生成器退出时额度恰好退一次。commit 先完成则保留该拍，stop 先完成则该候选永不落库。
14. `stopped` 是终态：`enqueue_turn` 拿到行锁后立刻抛 `story_stopped`（在幂等查询与其余检查之前），因此 stop 之后 act / continue / redirect / branch / continue_chapter / switch_perspective、新 command_id、旧 cancelled command_id 全部 409，不会新建 StoryTurn、不会回到 `active`；`replay` 仍只读可用。`GET /state` 继续返回 committed 历史。前端 `resumeSession` 见到 `status="stopped"` 直接清本地 session/key 回 idle，不显示 beat_paused 控件、不建 stream。
15. 前端 Stop 第一件事是作废在途恢复（`recoveryEpochRef += 1`、清 recovery owner）并立刻关闭 SSE，再用有上限的退避（500ms/1s/2s）+ 可被新 Stop/新 action 打断的 `/state` 探测复核；只有服务端确认 `status="stopped"`（或 404/409）才清本地 storage，未确认时保留 session key 并显示「停止尚未确认」，可再点一次。旧 `/state` 答复晚到不会重开 SSE。
16. 每个会碰状态的客户端恢复都带 fence 与 deadline：`probeStorySnapshot` 内置 10s deadline 并遵守调用方 AbortSignal；自动 resend 同样有 20s deadline，且在 await 前后比对 epoch / recovery owner，stale 时不改 `commandRef`、不开流；`connectStream` 用 `streamGenerationRef` 挡住「await auth 期间被 Stop/关闭」的连接；恢复请求组由 `abortRecoveryRef` 承载，Stop / reset / 新 command / 卸载都会立刻 abort。Stop 自身超时未答复时显示「停止尚未确认」而不是静默返回。
17. 恢复任务按 command 隔离：`activeRecoveryCommandRef` 决定谁拥有恢复（过期 `/state` 响应判 `stale`，不改 commandRef/notice/状态）、`turnRetryCommandRef` 让预算随 command 重置、`autoResendCommandRef` 保证 resend 前 command_id 必须一致、`recoveryEpochRef` 让 reset/stop/卸载作废在途探测。`/action` 返回 500–599 与网络异常同路（并且先切 `commandRef`）：原 command_id 保留、查 `/state`、必要时同 ID 重发一次；**重发本身再丢 ACK 也继续进入有上限轮询**。`/action` POST 有 20s deadline，永不答复的请求按不确定 ACK 恢复，不会停在「没有流、没有 watchdog、没有控件」的 streaming。新 action 收 409 `turn_in_progress` 时按 `/state` 的真实 `pending_command_id` 接管（复用同一份快照，只探测一次）并连上，不留在「没有连接却在 connecting/streaming」的状态。

**打架**：注释写「等开演」（`App.tsx` 908、1288）；按钮文案是「开始故事」（`src/lib/storyScene.ts` 74）；场面卡测试禁止出现「开演」（`src/components/StorySceneBillboard.test.ts` 23–25）。同一条路径，三个名字。

连线抽屉 / 额度：门上和进世界后都挂 `ConnectionSheet`（`App.tsx` 1711、1851）；额度 pill 在剧情顶栏（1908–1918）。未把每一条额度分支逐行读完 → 细节 **未读**。

### 单聊 / 群聊（现役）

单独打开 Direct / Crew 不会后台自动续跑旧 Story：App 只在进入 Story 模式后开启 `autoResume`。模式切换即时写入本地存储；旧请求返回时只修改原聊天线程的草稿/错误状态。验收记录：`docs/reviews/chat-story-boundaries-2026-09-18.md`。

本轮工作区已按新确认边界隔离：聊天记录、Direct 记忆、关系与草稿以 `chat-v2:<direct|crew>:<NPC id>` 为键；本地与云端使用同一键（云端沿用 TEXT 类型 `character_id` 列及现有 user_id RLS/加密，不增加生产迁移）。`/api/chat` 仍收到真实 NPC id，不收到存储键。旧裸角色键记录只在「旧版聊天记录」里回看；旧记忆原样保留但不自动进入新对话。Story 玩家身份单独存储，不改写聊天对象。后端独立聊天入口过滤剧情 session/world 字段，不接入 Story 数据库工厂。

发送：`App.tsx` 1377–1395 → `POST /api/chat`。后端只收 `direct`/`crew`（`backend/api/routes.py` 1304–1334、1409–1426）→ `director.handle_chat_message`（`backend/agents/director.py` 2510–2535）。

- 单聊：`bubbleFromDirectPayload`（`src/lib/directChatReply.ts` 16–29）。
- 群聊：`bubblesFromCrewPayload`（`App.tsx` 1422–1426）。

Direct 当前工作区已接通：核心角色 policy 不再被轻量 dossier 覆盖；五类 durable memory 都以「检索到的对话数据」进入上下文；中文身份/秘密/承诺/态度/约定提取已补回归测试。仍未部署，见 §6。

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
                ├─ story → useStoryStream → /api/session/create|state|stream|action
                │       ├─ runtime v1 → story.service → scenes.world_state → story.renderer → Director performance
                │       └─ legacy save → director.process_next_beat
                └─ direct/crew → POST /api/chat
                                  → director.handle_chat_message
                                    ├─ direct → _handle_direct_chat
                                    └─ crew   → _handle_crew_chat
```

HTTP 一共 27 条（`@router` 装饰器数）：

- `backend/api/routes.py`：health、connections×5、quota、tts×2、session×6、chat、agent×5 → 21
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

- 剧情表：原有 `sessions` / `messages` / `character_states` / `character_dossiers`；P0 工作区新增 `story_turns`，并给 `sessions` 增加 `world_state/world_revision/pending_command_id/...`（迁移 `h8i9j0k1l2m3`，未部署）。
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

旧 `interaction-qa.spec.ts` / `ix-qa.spec.ts` 已移到
`docs/archive/e2e/2026-09-17/`，不再进入 Playwright。仍有效的交互契约迁到
`current-interactions.spec.ts`，现役门类名是 `cold-open-showcase`。

两份 `one_night.json`：`src/features/game/one_night.json` 与 `backend/game/data/one_night.json`，`cmp` 相同（各 9013 字节）。不是死件，是双份同一份规则表。

---

## 5. 文档打架

不选赢家。两套「当前」并排。

| 题目 | 甲方 | 乙方 |
|---|---|---|
| 产品是什么 | 本文件、`CLAUDE.md`、README、CONTEXT 与 HANDOFF 开口均已对齐：三卡展台 → 剧情 / 单聊 / 群聊 | `docs/NIGHT_KERNEL.md` 仍把六回合夜晚写成主局；它是历史专项文档，不回滚现役入口 |
| 先读哪份 | 本文件由 CLAUDE 顶行、README 开口、HANDOFF「先读」指向 | 已对齐。HANDOFF §8 阅读顺序仍把本文件排在后面 |
| 本地端口 | 日常开发 5176 | Playwright 隔离服务器默认 5173；命令行覆盖 Vite 端口，属于预期行为 |
| 颜色 | `docs/COLOR_SCIENCE.md` 3、29：禁止 iOS 冷灰；`#292929` 不当世界色 | `src/main.tsx` 8–10 现役叠 `temp-apple-skin.css`。该皮肤自己写 ink greys 且 `--ink-1: #292929`（`temp-apple-skin.css` 3、42），同文件 652 又写 Not iOS grey-white |
| Marie | UI 8 人（`App.tsx` 74、213） | CONTEXT / CLAUDE / `CHARACTER_AGENTS` 写 7 人（见 §3） |
| README 接口表 | 已于 2026-09-17 更新为 `/session/create|action|state|stream|messages|plot-graph` | 与现役路由一致 |

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

下面不是已部署生产。工作区基线 `55df802`，P0 改动截至 2026-09-17 仍未提交/未部署。

本轮 P0 新增/改动重点：

- `backend/story/service.py`：Story command ledger、revision、claim/fencing、保存事件与分支 lineage。
- `backend/story/renderer.py`：先结算/校验/commit，再向 SSE 发布；失败候选不先泄露给客户端。
- `backend/scenes/world_state.py`：有限、确定性的 Story 世界状态与动作规则。
- `backend/alembic/versions/h8i9j0k1l2m3_story_command_ledger.py`：`sessions` 世界快照字段 + `story_turns`。
- `src/lib/storyCommands.ts` / `useStoryStream.ts`：普通动作改走 `act`；稳定 command id；刷新/重试/恢复。
- Direct：保留核心角色 policy；五类记忆全部进入模型上下文；中文提取、容量均衡与来源边界补齐。
- 独立复核：见 [`reviews/P0-independent-review-2026-09-17.md`](reviews/P0-independent-review-2026-09-17.md)。复核发现的 player-view 泄漏、公开事件缺失、旧 revision 倒退身份、任意 command id、场面叙述丢失、状态无界增长等问题已补回归并修复。
- 验证（2026-09-18 最终冻结快照）：后端 **730** 项通过；前端 **231** 项通过；默认 Playwright **69 passed / 3 skipped**（3 条均为需显式假 Supabase 环境的 Auth 契约），该契约 `npm run test:e2e:auth` 单独跑 **3/3** 通过；`npm run build`、`npm run lint`、改动范围 Ruff、`git diff --check` 与 PostgreSQL Alembic 离线链（到 head `i9j0k1l2m3n4`，含 `story_turns` 与全部服务端表 RLS）均通过。唯一构建提示仍是既有的单 chunk >500 kB advisory。
- 网络恢复闭环：`src/lib/storyRecovery.ts`（退避与「服务端到底持有什么」的判定）、`src/hooks/useStoryStream.ts`（有上限的重连/确认）、`backend/story/service.py:stop_turn`、`backend/api/routes.py` stop 分支。报告见 [`reviews/P0-network-recovery-2026-09-18.md`](reviews/P0-network-recovery-2026-09-18.md)。
- 两份删除界面的旧 E2E 已保存在 `docs/archive/e2e/2026-09-17/`，仍有效的契约迁入当前测试；默认 `playwright test` 不再被历史 selector 污染。

此处不复制一份易过期的逐文件 `git status`。当前工作区的真实改动清单以
Git 为准；整批 P0 仍未 commit、未 push、未迁移生产库、未部署。

---

## 7. 未读剩余

- 本会话结构图未初始化，5356 节点数未复核。
- `materials/`、`.ship`、历史循环、本地评测 JSON：不约束产品，未逐字读。
- `docs/archive/`、`docs/code-wiki/`、`docs/agent-harness/`：只登记，未当规格读。
- §5「过期仍放根上」各文件：只读了标题/开头。
- 额度每一条分支、线路存储实现、发布门禁 / how-to 规则全文、Crew 独立采样细节：未打穿。
- 线上 VM 此刻默认门是否与本机一致：本会话未打开生产站。
- `NightStartCta` 最后一次被默认路径引用的 git 历史：未查。
