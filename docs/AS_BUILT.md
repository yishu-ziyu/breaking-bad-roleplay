# 现状地图（as-built）

写于 2026-09-15，更新至 2026-09-18。只记当前工作区现在是什么。不写「应该是」。对不上写「打架」或「未读」。未提交/未部署的改动会明确标注。

## 已锁定（2026-09-17）

当前默认首页是三卡展台：**Story / Direct / Crew 三种模式直接并列**。Direct / Crew 是独立 AI 聊天，Story 才是叙事游戏；不强制串成一个 Game Loop。`55df802` 已把旧「索尔先打招呼再选模式」入口替换为三卡首页；不要因为旧文档或旧 E2E 仍写索尔门而恢复旧入口。

旧夜路页、黄色「开始这一夜」门、杰西插画封面：不是首页候选项。画可以以后再用，不要把那些页恢复成默认入口。

六回合夜晚是剧情下面的内容，不是第四扇顶部门。今天：已实现，只走 `?night=1`，不在默认剧情路径上。不要把它叫成未加限定的「正式局」。

**剧情对访客关闭（2026-09-18，工作区改动，未提交/未部署）**：线上暂时不开放剧情板块。访客点 STORY 卡或玩法条里的「剧情」只会看到「剧情正在开发中」提示，不进剧情；作者／本地开发照常进。开关与文案在 `src/lib/storyAvailability.ts`：`?authoring=1` 打开并写入 localStorage `yishu_authoring_mode`（`= '1'`），`?authoring=0` 关闭并删除该键，无参数时读该键。故意不用 `import.meta.env.DEV`——本地 `npm run dev` 与部署构建走同一套代码。细节与证据见 §2「剧情（访客关闭，作者可开）」。

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
| Story（访客） | 点「开始故事」 | **不进剧情**：卡上「开发中」标记 + 卡内 `role="alert"` 提示 | `ColdOpenLanding.tsx` 148–162、248–284；开关见 §2 |
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
18. 会话级失败（2026-09-18 T2，未提交/未部署）：`POST /api/session/create` 失败与流内 `error` 事件不再只写进 `errorByChar['__session__']`。hook 新导出 `sessionFailure: { kind: 'session_create' | 'beat_rejected', status, detail }`；请求与分类抽到 `src/lib/storySessionStart.ts`（`readFailureDetail` 把 `{detail:{code,message}}` 解成字符串，不再是「[object Object]」，200 但没有 `session_id` 也算失败）；文案在 `src/lib/storyFailureCopy.ts`，UI 组件 `src/components/StoryFailureNotice.tsx`（role="alert"，headline + 直白说明 + 热点重试按钮），App 在 `connectionState === 'error' && story.sessionFailure` 时渲染它，其余 error 分支不变。重试 = 用同一段开场重跑（`handleRetryStoryStart` → `handleRaiseCurtain`；`startStory` 改为返回 boolean，失败时不再清空 `storyTask`）；beat 被拒且 session 还在时重试 = 重连同一 session。原始服务端字符串只留在 `detail` 供排查，不作为玩家可见主文案。
19. 恢复提示随界面语言（2026-09-18 T8，未提交/未部署）：存档失效 / 无法确认两条旧英文 toast 去硬编码，走 `storyFailureCopy.ts:storyResumeNoticeCopy`；`resumeSession` 读取失败不再经 `getCharState().error` 显示原始英文串，改为复用 T2 的提示卡（`kind: 'resume_failed'`），重试 = `retryResume` 用同一 sid 重开、不新建故事。语言取 App 传入的实时 `language`，首次访问 `abq_language` 未写入时也跟界面走。
20. 开场正文 / 地点不再印内部标识（2026-09-18 T7，未提交/未部署）：世界快照仍是机器值（`location="scene"`、`present=["walter"]`），呈现层统一走 `scenes/world_state.py` 的 `actor_label` / `location_label` 与 `_cast_line`（zh/en 两套名表，fallback 只 humanize、不回显下划线 token）；`opening_scene_text` 对占位地点 `scene` 直接说「故事在此刻展开 / The story opens here」，`resolution_text`（移动、交接、观察）也全部过同一层。`story/renderer.py` 的 `scene_change.from_scene / to_scene` 现在发本地化地点名（顶栏、右侧局势面板读的就是它；旧 director 路径本来就发人读场景名）。舞台指令在 `src/lib/storyReading.ts` 渲染成句：`character_policy` 的 `look_at → walter` 之类按 `STAGE_VERBS` + `STAGE_NAMES` 出「〔斯凯勒看向沃尔特〕/〔Skyler looks at Walter〕」，未知机器动词直接不写进正文，legacy 散文动作照旧；`extractOnStageLore` 对旧 payload 的裸 `scene/desert/rv` 也做同样映射兜底。测试：`backend/tests/test_world_actions.py`（呈现层单测）、`test_story_runtime_api.py::test_fresh_conversation_opening_has_no_internal_ids`（zh/en SSE）、`src/lib/storyReading.test.ts`（舞台指令 + 地点标签）。
21. 角色回合被拒的原因与同拍重生成（2026-09-18 T12，未提交/未部署）：runtime v1 每拍必须有至少一个可发布的角色 `agent_speak`；被拒时 `story/renderer.py` 记录原因（计划的台词写给玩家 / 说话人不在场 / 计划里根本没有角色台词 / 角色回合被校验拒 / 角色子代理调用失败），抛 `StoryTurnRejected(code, retryable, detail, reasons)`，`api/routes.py` 转成带 `code` / `retryable` / `detail` 的 SSE `error` 事件，`code` 可为 `no_accepted_character_turn`、`character_subagent_failed`、`beat_llm_retry_exhausted`、`beat_parse_failed` 等。同一拍内**至多重新生成一次**（`BEAT_TURN_REGENERATION_ATTEMPTS = 2`，同 command、同计费）：整拍无角色台词时带原因再生成一次；计划里没有角色台词时 `director._generate_beat` 先按在场非玩家名单纠正后重规划一次（`BEAT_SPEAK_REGEN_ATTEMPTS = 2`）。desert 权威板下角色代理只准用舞台动词（`look_at/turn_to/gesture/sit/stand/idle/idle_tense`），角色子代理调用也走 T3 的瞬时网络重试；`beat_json.py` 对模型把 `agent_speak` 括号写早/输出被截断的坏 JSON 逐个抢救完整事件对象。不降级成旁白；重生成后仍无角色台词才拒绝并带原因上报。
22. 计划说话人先规范化再进角色管线（2026-09-18 T14，未提交/未部署）：beat 计划里的说话人若写短 id（如 `"jesse"`）而不是规范全名（`"Jesse Pinkman"`），原来会 `CHARACTER_AGENTS.get()` 落空、整段 Character Policy / 校验被跳过，规划草稿台词直接发布——同一句写全名则走策略。现在 `director._generate_beat` 在 actor 过滤 / `hoist_perspective_speak` / 角色表演之前先跑 `canonicalize_plan_speakers`：带 `character_id` 的事件统一经 `canonical_playable_character_id`（`resolve_playable_character_id` 的非抛错形式，与 Direct/Crew 同一套 `FRONTEND_TO_BACKEND_ID` / `CHARACTER_AGENTS` 映射，没有第三张表）改写为规范名；仍解析不出的 `agent_speak` / `agent_think` 整条丢弃，把 `{type, character_id, reason:"unresolved_speaker", code, retryable:true}` 写进 `context["turn_rejection_log"]` 并打 WARNING——丢弃后整拍无可发布角色台词时走既有的同拍重生成（`BEAT_SPEAK_REGEN_ATTEMPTS`），仍无则 T12 的 `no_accepted_character_turn` 带原因拒绝，不静默发布兜底；policy 循环里 `CHARACTER_AGENTS` 落空的 `agent_speak` 也只丢弃+记原因，不再落到「purify 后发布」的路径。`story/renderer.py` 的发布闸再加一层：`agent_speak` / policy `agent_act` 的说话人必须是可玩的规范角色，否则以 `unresolved_speaker`（不在可玩名单）或 `speaker_not_canonical`（可解析但没走规范化，意味着策略被跳过）拒绝并进 `rejected_events` / 日志。测试 `backend/tests/test_plan_speaker_policy.py`（8 项）。

**打架**：注释写「等开演」（`App.tsx` 908、1288）；按钮文案是「开始故事」（`src/lib/storyScene.ts` 74）；场面卡测试禁止出现「开演」（`src/components/StorySceneBillboard.test.ts` 23–25）。同一条路径，三个名字。

连线抽屉 / 额度：门上和进世界后都挂 `ConnectionSheet`（`App.tsx` 1711、1851）；额度 pill 在剧情顶栏（1908–1918）。未把每一条额度分支逐行读完 → 细节 **未读**。

### 剧情（访客关闭，作者可开 — 2026-09-18 T10，未提交/未部署）

决定：线上暂时不开放「剧情」板块。访客点剧情只看到「正在开发中」，不进剧情；本地开发与作者视角仍要能进剧情继续开发。

- 开关：`src/lib/storyAvailability.ts`。`?authoring=1` → 作者态，并写 localStorage `yishu_authoring_mode = '1'`；`?authoring=0` → 访客态并删键；无参数时读该键；都没有则访客。query 与 hash 都认；`?authoring=2` 之类不算。App 每次加载解析一次（`App.tsx:766–767`）。**故意不用 `import.meta.env.DEV`**：本地 `npm run dev` 与部署构建走同一套代码（wire 测试禁 App 出现 `import.meta.env`）。
- 访客点 STORY 卡：卡上「开发中」标记 + `data-story-open="false"` + `aria-disabled`；点击不弹知识点、不调 `onStart`，卡内出 `role="alert"` 提示（`ColdOpenLanding.tsx:150–168、246–286`）。点哪算什么的判定在 `storyCardClickOutcome`（关闭优先于已存知识档）。
- 访客点玩法条「剧情」：按钮带 `aria-disabled` 与「开发中」，点击不切 surface，条下出同一条提示（`PlayModeBar.tsx:39–72`；挂载点 `App.tsx:2005、2307`）。判定在 `playModeBlocked`（只挡 story，单聊/群聊照常）。
- 设置抽屉里的 view 切换（剧情/单聊/群聊）是同一扇后门，也走 `App.tsx:1390 requestSurface`，挡住并出提示（`App.tsx:1948–1952`）。`handleColdOpenStart` 另有硬保险 `if (!storyOpen) return`（`App.tsx:1362`）。
- 文案（中英各一份，直白，无内部术语、无比喻）：卡/按钮标记「开发中」/「In development」；提示「剧情正在开发中，暂时无法进入。你可以先体验单聊或群聊。」/「Story mode is still in development and cannot be opened yet. Direct chat and Crew work right now.」（`storyComingSoonCopy`）。组件 `src/components/StoryComingSoonNotice.tsx`（`role="alert"`），样式在 `App.css`（`.showcase-card__soon` / `.story-coming-soon` / `.play-mode-bar__notice`）。
- 两种态的测试：`src/lib/storyAvailability.test.ts`（17 项：11 项注入 `search` / `storage` 覆盖访客与作者，6 项覆盖已存 surface 回收）、`src/lib/storyGate.wire.test.ts`（5 项：卡/条/设置都过同一判定，回收调用点在 `enteredWorld` hydration 之前，App 不出现 `import.meta.env`）、`src/components/StoryComingSoonNotice.test.ts`（3 项）、`ColdOpenLanding.test.ts` 与 `PlayModeBar.test.ts` 各补两态标记断言；浏览器级 `tests/e2e/story-closed-to-visitors.spec.ts`（9 项：访客中文/英文卡、玩法条、设置抽屉、作者 `?authoring=1` 进剧情并开局、`?authoring=0` 关回去，以及 T13 的三条存储回收）。
- 现役 E2E 里走剧情门的 spec（`cold-open-drama.spec.ts`、`mode-boundaries.spec.ts`、`sse-story.spec.ts`、`current-interactions.spec.ts`、`network-recovery.spec.ts`、`reliable-story-memory.spec.ts`、`story-resume-language.spec.ts`、`story-start-failure.spec.ts`、`functional-components.spec.ts` 的剧情用例）已在 seed 里打开作者开关——它们测的是作者/开发流程；Direct/Crew 用例保持访客身份。
- 已存剧情 surface 的回收（2026-09-18 T13，未提交/未部署）：只挡「点」不够——访客本地若已存剧情 surface（`abq_enteredWorld=true` + `abq_surface='story'`，或旧版没有 surface 键），刷新会直接回到剧情并可继续。现在 App 在 pre-paint 复位：`reclaimVisitorStorySurfaceBeforePaint`（`App.tsx`，紧接三个迁移之后、`usePersistedState('enteredWorld')` 之前）把访客的 `abq_enteredWorld` 写回 false，首帧就是冷开场入口，不会先渲染剧情再跳走；作者态（`?authoring=1` 或已存开关）不受影响。判定与存储形状在 `src/lib/storyAvailability.ts:reclaimVisitorStorySurface`：只回收剧情 surface（缺 surface 键 = 应用默认 story），`abq_surface='direct'/'crew'` 与 `?surface=direct|crew` 的访客照旧留在单聊/群聊；只写 `abq_enteredWorld=false`，不动 `abq_story_session_id`（作者切回 `?authoring=1` 仍能接着同一局）。测试：`src/lib/storyAvailability.test.ts` 6 项、`src/lib/storyGate.wire.test.ts` 1 项（钉住调用点在 hydration 之前）、`tests/e2e/story-closed-to-visitors.spec.ts` 新增 3 项（访客 seed 剧情 surface → 冷开场且 story shell 从未进过 DOM；作者流程 → `?authoring=0` → 冷开场；作者 seed → 仍留在剧情）。

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
| CONTEXT 表 | 8 个，含 Marie | `CONTEXT.md` 7–16 |
| 导演可演 | 8 个，含 Marie | `director.py` 553–562 |
| 前端 id 映射 | 8 个，含 marie | `director.py` 324–334 |
| 未知 id | 明确失败：400 `unknown_character` + 服务端日志，不回落；聊天入口与剧情 `switch_perspective` 同一契约（T9） | `director.py` 443–472；`api/routes.py` 104–115、772–785、858–866；`tests/test_switch_perspective_availability.py` |
| Marie 模块 | 已进导演表（2026-09-18，工作区改动，未提交/未部署） | `backend/agents/characters/marie.py`；`character_policy.py` `_CORE_PROMPTS` |

2026-09-18 修复：此前「界面有 Marie、导演当成沃尔特」的打架已解除。CONTEXT / CLAUDE 同步为 8 人。旧行为（未知 id 落 Walter）是 `FRONTEND_TO_BACKEND_ID.get(..., "Walter White")` + `CHARACTER_AGENTS` 兜底造成的，已删除；`resolve_backend_character_id` 仍宽松（供 resume 路径），聊天入口走 `resolve_playable_character_id`。

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
| Marie | 已对齐（2026-09-18）：UI / CONTEXT / CLAUDE / 导演映射均 8 人，未知 id 明确失败（见 §3） | 无 |
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
- 启动 schema 门卫（2026-09-18，未提交）：`backend/db/schema_check.py` 在 lifespan（`backend/main.py:_enforce_schema_current`）里用 stdlib `ast` 解析 `alembic/versions/*.py` 得到 head，与 DB 的 `alembic_version` 比较；落后时日志打印 `uv run python -m alembic upgrade head` 并非 0 退出（uvicorn exit 3）。APP_ENV=test / pytest 进程 / 非 PostgreSQL / 连不上 / 无 psycopg2 时安静跳过，不碰现有单测。测试 `backend/tests/test_schema_version_check.py`（13 项）用 alembic `ScriptDirectory` 钉住 head 解析。改动后后端全量 **753** 项通过（本会话实跑）。
- 会话级失败提示（2026-09-18 T2，未提交）：见 §2 剧情第 18 条。新增 `src/lib/storySessionStart.ts`、`src/lib/storyFailureCopy.ts`、`src/components/StoryFailureNotice.tsx` 与其单测；`useStoryStream.startStory` 改为返回 boolean；`tests/e2e/sse-story.spec.ts` 的 TC-SSE-5 改为断言这套新提示。验证：前端 **238** 项通过（`npm test`，较冻结快照 +7）；默认 Playwright **72 passed / 3 skipped**（隔离端口 5183 实跑，含新增 `tests/e2e/story-start-failure.spec.ts` 2 项）；`npm run lint`、`npm run build` 通过（仍是同一条 chunk >500 kB advisory）。
- 拍内瞬时网络重试（2026-09-18 T3，未提交）：`backend/agents/director.py` 的 beat 规划调用（`_generate_beat` → `_plan_beat_events` 的主调用与 JSON repair 调用）改走 `call_model_with_transient_retry`：只对瞬时传输错误（httpx/httpcore 的 `ReadError` / `ConnectError` / `ReadTimeout` / `ConnectTimeout` / `RemoteProtocolError`）重试 1 次（`BEAT_TRANSIENT_RETRY_ATTEMPTS = 2`，退避 0.5s）。重试发生在同一条 beat / command / 计费内，不产生第二次额度扣减或 outbox 记录；耗尽后 error 事件带 `code="beat_llm_retry_exhausted"` + `retryable=true`，非瞬时错误保持 `code="beat_llm_failed"` + `retryable=false`，解析失败带 `code="beat_parse_failed"`；`backend/story/renderer.py` 的拒绝异常带上原因（`character_turn_rejected:<code>`）。测试 `backend/tests/test_beat_transient_retry.py`（11 项，含流级「一次计费一次退款」断言）。
- 换视角未知角色明确失败（2026-09-18 T9，未提交）：`POST /api/session/{id}/action` 的 `switch_perspective` 在分支处理前改用 `resolve_playable_character_id` 严格校验 `target_character`，未知 id 在 legacy 与 runtime v1 两条路径都返回 400 `{code:"unknown_character", message, characterId}` 并在 `api.routes` 记 WARNING（与 `/api/chat` 的 T4 契约一致）；legacy 分支不再把未知字符串原样落库，已知角色仍持久化前端短 id（如 `hank`→`hank`、`Hank Schrader`→`hank`）；runtime v1 的「已知但不在场」仍由世界规则给出 `target_absent`，未改。测试 `backend/tests/test_switch_perspective_availability.py`（6 项）。
- 开场正文 / 地点的呈现层本地化（2026-09-18 T7，未提交）：见 §2 剧情第 20 条。改动 `backend/scenes/world_state.py`（名表 + `opening_scene_text` / `resolution_text`）、`backend/story/renderer.py`（scene_change 发本地化地点）、`src/lib/storyReading.ts`（舞台指令成句 + 旧 payload 地点兜底）；测试加在 `backend/tests/test_world_actions.py`、`backend/tests/test_story_runtime_api.py`、`src/lib/storyReading.test.ts`。真机证据（5176 + 8001，新开一局）：zh 正文「故事在此刻展开。此刻在场：你（沃尔特）。」、顶栏/右栏「现场」、舞台指令「〔杰西站起身〕」；en「The story opens here. On stage: you (Walter).」/「Story scene」/「〔Skyler looks at Walter〕」。未部署。
- 两份删除界面的旧 E2E 已保存在 `docs/archive/e2e/2026-09-17/`，仍有效的契约迁入当前测试；默认 `playwright test` 不再被历史 selector 污染。
- 剧情对访客关闭（2026-09-18 T10，未提交）：见 §2「剧情（访客关闭，作者可开）」。新增 `src/lib/storyAvailability.ts`（开关 `resolveAuthoringMode` / `canEnterStory` / `playModeBlocked` / `storyCardClickOutcome` + 中英文案）、`src/components/StoryComingSoonNotice.tsx`，改 `ColdOpenLanding.tsx`（卡标记 + 拦截 + 提示）、`PlayModeBar.tsx`（只挡剧情）、`App.tsx`（解析开关、设置抽屉同闸、开局硬保险）、`App.css`（标记/提示样式）；`cold-open-drama.spec.ts`、`mode-boundaries.spec.ts` 的 seed 打开作者开关。验证：`npm test` **276** 项通过，`npm run lint`、`npm run build` 通过（仍是同一条 chunk >500 kB advisory）；默认 Playwright 在 5176 **85 passed / 3 skipped**（3 条仍是需显式假 Supabase 的 Auth 契约），其中新增 `tests/e2e/story-closed-to-visitors.spec.ts` 6 项。
- 访客已存剧情 surface 的回收（2026-09-18 T13，未提交）：见 §2 剧情「已存剧情 surface 的回收」。`src/lib/storyAvailability.ts` 加 `reclaimVisitorStorySurface`（纯函数，注入 read/write，只认字面 `true` + 剧情/缺省 surface），`App.tsx` 加 `reclaimVisitorStorySurfaceBeforePaint(storyOpen)` 并放在 `usePersistedState('enteredWorld')` 之前（同一次渲染、首帧之前）；顺手补上 T10 `requestSurface` 漏掉的 `setStoryClosedNotice` 依赖（React Compiler 的 `react-hooks/preserve-manual-memoization` 在本次改动后才发现）。seed 剧情 surface 的 9 个 spec 显式打开作者开关（`sse-story` / `current-interactions` / `network-recovery` / `reliable-story-memory` / `story-resume-language` / `story-start-failure` / `functional-components`，`cold-open-drama` / `mode-boundaries` 已于 T10 打开）；`story-closed-to-visitors.spec.ts` 新增 3 项（含 MutationObserver 证「story shell 从未进过 DOM」）。验证：`npm test` **283** 项通过、`npm run lint`、`npm run build` 通过（同一条 advisory）；默认 Playwright 在 5176 **88 passed / 3 skipped**。
- 角色回合被拒的原因 + 同拍重生成（2026-09-18 T12，未提交）：见 §2 剧情第 21 条。根因实测（修复前 33 次 8001 实跑中 11 次整拍失败）：主因是规划模型给出的 beat 方案没有可发布的角色台词——要么根本没写 `agent_speak`，要么把台词写给玩家（`speaker_is_player`），世界过滤后整拍无角色回合；其次是角色回合被 `unsettled_action` 等校验拒掉（character agent 选了 `walk_to/open/close` 这类世界规则动词）；此外模型会把 `agent_speak` 的闭括号写早，导致 `"recommended_model"` 悬空在 events 数组里，JSON 解析连修复调用一起失败；以及角色子代理调用遇到瞬时 `ReadError`。改动：`backend/story/renderer.py` 新增 `StoryTurnRejected`（code/retryable/detail/reasons）、`_collect_beat_events`（记录每个被拒事件与原因）与一拍内**至多一次**重生成（`BEAT_TURN_REGENERATION_ATTEMPTS = 2`）；`backend/agents/director.py` 在计划无角色台词时按在场名单纠正后重规划一次（`BEAT_SPEAK_REGEN_ATTEMPTS`）、把校验/调用失败原因写入 `context["turn_rejection_log"]`、desert 权威板下给角色代理加封闭动词限制、角色子代理调用也走 T3 的瞬时重试；`backend/agents/beat_json.py` 在结构被写坏时逐个抢救完整事件对象；`backend/api/routes.py` 把 `StoryTurnRejected` 转成带 `code`/`retryable`/`detail` 的 SSE error 事件。测试：`backend/tests/test_character_turn_regeneration.py`（11 项，含「被拒 → 同拍重生成一次 → 成功」与「原因进日志/code」）、`backend/tests/test_beat_json.py`（+3 项）。验证：后端全量 **791** 项通过；8001 实跑修复后 **13/13** 冷开场 desert 开局都出现角色台词且无 `no_accepted_character_turn`（其中 3 次由同拍重生成救回，日志含原因与重试记录）。未部署。
- 计划说话人规范化（2026-09-18 T14，未提交）：见 §2 剧情第 22 条。`backend/agents/director.py` 新增 `canonical_playable_character_id`（`resolve_playable_character_id` 改为复用它的非抛错形式）与 `canonicalize_plan_speakers`；`_generate_beat` 在 actor 过滤 / `hoist_perspective_speak` / Character Policy 之前调用，policy 循环对 `CHARACTER_AGENTS` 落空的 `agent_speak` 只丢弃+记原因（不再落到「purify 后发布」的兜底）；`backend/story/renderer.py` 的 `_collect_beat_events` 增加 `unresolved_speaker` / `speaker_not_canonical` 两类拒绝原因（前后各一层，短 id 直通发布不可能再发生）。测试 `backend/tests/test_plan_speaker_policy.py` 8 项（短 id 走 policy、未解析说话人不发布且带 code/retryable 并同拍重生成、渲染层两类拒绝、真实 director+发布闸的拒绝 detail 带原因、规范名照常发布）。验证：后端全量 **799** 项通过（较 T12 的 791 +8）；`cd backend && uv run ruff check` 改动文件通过（整仓仍有 22 条既有告警，均不在本次改动文件）；8001 真机冷开场 zh **3/3** 出角色台词且无 error（日志无 ERROR、无 `unresolved_speaker`；发布事件说话人为规范名 `Jesse Pinkman`）。未部署。

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
- ~~访客已存剧情 surface 的强制回收（§2 T10 边界）~~：**已补（2026-09-18 T13）**——pre-paint 把 `abq_enteredWorld` 写回 false，见 §2 剧情「已存剧情 surface 的回收」与 §6 末条；上面那份 spec 清单已按此显式打开作者开关。
- `NightStartCta` 最后一次被默认路径引用的 git 历史：未查。
