# DEVLOG · 2026-08-27 · FTUE 重构 + QA 修复轮

> 背景：用户以评测师视角挑战产品 → 全流程实玩 QA（见 [QA-2026-08-27.md](QA-2026-08-27.md)）→
> 本轮按严重度修复。所有改动未部署，仅本地 dev 验证。

## 时间线

| 时间 (approx) | 事件 |
|---|---|
| 早些时候 | 冷开场视觉重制（BB 色彩科学：钠灯琥珀/防化服黄绿/文楷 display 脸/时间码 OSD） |
| 同日 | 白皮书落库（NN/g + Overwolf FTUE + Hodent + Agency）→ 知识分层 FTUE（简报屏一问定轨道） |
| 同日 | QA 实玩：3 节拍 + 单聊 + 档案 + 刷新恢复 → 11 个问题（4P0/4P1/3P2） |
| 本轮 | 修复 P0 全部 + P1 四项 |

## 环境事故（先于代码修复）

**本地库未跑迁移导致"主页面打不开"。** `d66ed47` 给 `sessions` 加了
`owner_token_hash` 列，commit message 写了 `Requires: alembic upgrade head`，
本地没执行 → 每次建会话 `UndefinedColumnError`。已执行 `cd backend && alembic upgrade head` 修复。

**教训**：commit message 里的迁移要求没人看。已加前端自查提示（见 #4），
后续考虑后端启动时检测 schema 版本落后并打 WARN。

## 修复清单

### P0#1/#2 — SSE 静默卡死（最严重）

**症状**：第三拍"后果正在变化"转圈 80s+，永不出结果。后端 session 已 `waiting`，纯前端状态机死锁。

**根因**：`connectionState` 只在收到 `beat_ready`/`complete`/`error` SSE 事件时才离开
`streaming`。SSE 静默闭合（代理超时、网络抖动）不触发任何终态 → 永久 spinner。

**修复**（`src/hooks/useStoryStream.ts`）：
1. **看门狗** `armStallWatchdog`：每个 SSE 事件重置 90s 计时器；超时先**静默重连一次**
   （`stallReconnectRef` 一次性闸门），再失败进入 error 态。
2. **`onNetworkError` 同策略**：streaming 中首断静默重连，二次失败报错。
3. **`streamFailure` 分类**：`timeout | network | http | unknown` 四类，App 层据此渲染
   中文人话文案 + 「重试演出」出口。
4. 契约测试锁死：`useStoryStream.test.ts` 校验 `streamFailure` 类型 + 看门狗存在。

**未做**：以 session status 轮询对账（更强的正确性保证）——留给下一轮，看门狗已覆盖 90s 内的自愈。

### P0#3 — 双入口双视觉

**症状**：重载/老玩家落在旧版「开场设定」浅色页，与新冷开场像两个产品。

**根因**：`handleReturnToLanding` 只 reset 会话，不清 `knowledgeTrack`、不重置 `surface`。
stale 的 `surface='direct'` + `hasEnteredWorld=false` → 渲染旧 idle 表单。

**修复**（App.tsx）：回到主页时 `setKnowledgeTrack(null)` + `setSurface('story')`，
强制走 简报→危机→选角 唯一链路。旧「开场设定」表单保留（无知识轨道时的兜底入口），
但正常路径不会再看见。

### P0#4 — 建会话失败零信息

**修复**：cold open 错误处理按错误签名分类，附中文自查清单
（后端没跑 / 迁移落后 / 额度用完）。原始错误仍显示（不吞真相）。

### P1#5 — McKee 术语泄漏

**症状**：场景卡显示「值: 安全→隐隐不安 — 间隙: …」、分镜出现「〔turn_to → Walter〕」。

**修复**（`playerFacingSceneText`）：
- 连续 craft 字段块（值/gap/价值/间隙/risk/风险/value）整体剥离；若剥离后无实质内容则整句置空。
- `〔turn_to → X〕` / `[turn_to → X]` 舞台指令标记正则清除。
- 原有 `Transitioning to:` / 编号前缀 / `[setup]` 等规则保留。

### P1#6 — 后果面板截断不可读

**修复**：`story-delta-strip` 从 `<div>` 改 `<details>`——summary 保持单行 ellipsis
预览，展开显示 4000 字符全文（`white-space: pre-line`）。

### P1#7 — 单聊死胡同

**修复**：chat header 加「← 返回剧情」按钮，仅当 `story.sessionId` 存在且非 idle
时显示（无故事的纯单聊不加噪音）。

### P1#8 — HUD 张力空白

**修复**：`storyTensionLabel` 空值 fallback「未定 / Unset」。
（「节点 1 不动」不是独立 bug——beat_ready 没到导致 beatIndex 不涨，#1 修好后自然恢复。）

## 验证

| 检查 | 结果 |
|---|---|
| `npm run build` | ✅ 462ms，无 TS 错误 |
| `npm test` | ✅ 90/90（新增 streamFailure 契约测试） |
| `npm run lint` | 8 个存量问题（stash 验证与本次无关） |
| 本地实玩 | 会话创建恢复 ✅；三拍演出（#1 修复前实录）；SSE 看门狗为防御层，需下次 LLM 抖动时实测 |

## 遗留（下一轮候选）

1. **零埋点**：FTUE 漏斗无数据，引导是否丝滑仍靠人肉
2. SSE 对账轮询（比看门狗更强的正确性）
3. StepFun key 欠费——已不阻塞（见下），但充值后可互为热备
4. 后端启动 schema 版本检测 WARN

## 第二轮（同日）：MiniMax 主路由 + P2 清尾 + 最小拆分

用户指令：测试优先 MiniMax；P2 三条和架构债一块做完。

### R1. LLM 主路由切换（MiniMax 优先）

- `backend/config.py`：`director_model_route` 默认改空 → validator 按 key 派生
  （有 `MINIMAX_API_KEY` → `minimax/MiniMax-M3`，否则 stepfun；显式 env 永远赢）。
- `backend/agents/provider.py`：
  - `resolve_model_route` 同步按 key 派生；
  - **新增 minimax→stepfun 对称 fallback**（原来只有 stepfun→minimax 单向）。
- 测试：`test_config.py` 更新默认断言 + 新增 stepfun-only / 显式 env 两条；
  `test_provider_parsing` 等不受影响。**后端 524 全过**。
- 本地后端已重启加载新路由。

### R2. P2#9 — chips 每拍重名

- `DramaDecisionBar.tsx`：say/do/observe 各建 4 个变体 label 池
  （`BEAT_PAUSE_LABELS`），`buildBeatPauseSuggestions` 加 `beatIndex` 参数，
  `(beat-1) % pool.length` 确定性轮换。payload/grammar/id 不变。
- 新增测试：相邻拍 label 不同、池回绕、确定性、id 稳定。**前端 91 全过**。

### R3. P2#10 — 游戏内语言切换

- story HUD 加 中文/EN 药丸切换（同冷开场工具条语法，琥珀 active 态）。
  设置抽屉里的切换保留（两处同源 `setLanguage`）。

### R4. 架构债最小拆分 — coldOpenCopy

- `src/components/coldOpenCopy.ts`（新，218 行）：全部冷开场文案纯数据
  （COLD_OPEN_PROMPTS 双轨 / CRISIS / BRIEF / CHOICE / UI / ENTERING / COLD_OPEN_CAST + 类型）。
- `ColdOpenLanding.tsx` 从 564 → 369 行（-34%），纯组件逻辑。
- App.tsx 导入路径不变（landing re-export）。

### 验证

| 检查 | 结果 |
|---|---|
| `npm run build` | ✅ 256ms |
| `npm test`（前端） | ✅ 91/91 |
| `uv run pytest`（后端全量） | ✅ 524/524 |
| 后端重启加载新路由 | ✅ health 200 |
