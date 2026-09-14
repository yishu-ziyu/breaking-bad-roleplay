# 这一夜 — 活计划（锁定）

基线：`main @ bc7d8f5`（2026-09-14）  
来源：全栈方案 `abq-full-stack-iteration-bc7d8f5.md`、GitHub #59。  
#66（Node / pi-agent）本轮不做，状态为**推迟**。对比合同见 [PERFORMANCE_RUNTIME.md](PERFORMANCE_RUNTIME.md)。Direct / Crew 只作次级实验入口，不并行扩功能。

## 产品承诺（不要改写成别的）

不是「和绝命毒师角色聊天」，而是：

> 在一个晚上，先决定要保住什么，并接受其余部分失控。

玩家固定为沃尔特。一局一个夜晚、六回合、两到三个主要 NPC。选择必须有可见代价；NPC 会按自己的目标行动；结局必须能追溯到更早的行动。

## 验收契约（本轮）

```
Change: player can finish one 6-turn night where choices have visible costs, NPCs act on their own, and the ending explains why they arrived there from earlier choices
Not this: more characters, more modes, prettier chat, swapping LLM runtime, or “story still works if you ignore the numbers”
Evaluator: tests that run WITHOUT LLM for M1; CI green for M0; a playable path a human can complete
Gate: M0 = Linux frontend build + backend pytest actually start; M1 = six-turn kernel + minimal UI without network LLM
Evidence: CI logs, test output, screenshots of the new game screen if UI is in this increment
```

旧 Story 的 `DramaDecisionBar` 仍 `void contextHint`、三条固定 payload——那是旧入口的症状。正式局用新行动+成本界面，不把内核塞进 `App.tsx` 的聊天/Story 分支。

`backend/scenes/state_reducer.py` 只保证叙事连续性，不是游戏规则内核。

## 模块

| 层 | 路径 | 职责 |
|---|---|---|
| 规则表 | `src/features/game/one_night.json` | 场景、行动、成本、NPC、承诺、结局。设计者改代价不必改 Director。 |
| 内核 | `backend/game/kernel.py` + `src/features/game/kernel.ts` | 无 LLM、无数据库。顺序固定：校验行动 → 玩家效果 → 推进时间 → NPC → 到期承诺 → 结局 → 下一组合法行动。 |
| 界面 | `src/features/game/` | `GameScreen` 及场景 / 行动 / 后果 / 复盘。规则状态只来自内核。 |
| 旧叙事管线 | `director.py` 等 | 留给 M3 演出。Propose → Validate → Repair → Commit 仍有效，本轮不接。 |

AI 不得发放资源、发明承诺、或代替沃尔特做决定。

## 接口（M2 才持久化；M1 可内存 / 本地内核）

```
POST /api/game/start
POST /api/game/{id}/actions
GET  /api/game/{id}
GET  /api/game/{id}/events?after=<cursor>
POST /api/game/{id}/branches
```

行动：`action_id` + `expected_revision` + `choice_id`。相同 `action_id` 同请求返回同一结果；过期 revision 冲突，不静默套用。只返回 PlayerView。

## 数据（M2）

`game_runs` / `game_actions` / `game_events` / `game_checkpoints` / `performance_jobs`。  
世界真相、角色认知、玩家观察三者分开。LLM 摘要不得覆盖规则。

## 阶段门禁

| 阶段 | 出口 | 状态 |
|---|---|---|
| **M0 发布可信** | Linux 前端构建通过；后端 pytest 真正启动；E2E 不再因上游失败而跳过 | 文件侧已齐：`pytest`（不用 `uv`）、lockfile 含 Linux Rolldown binding、e2e `continue-on-error`。Linux Actions 未跑过——要 push 才算数。生产 READY ≠ 本门完成 |
| **M1 游戏成立** | 无 LLM 打完六回合；策略差异可解释；旧承诺会回来；最小 `GameScreen` | 可玩：`http://127.0.0.1:5176/?night=1`。G1–G4 单测绿。未做 API/存档 |
| **M2 结果可信** | 幂等 API、事件/快照、断线恢复、分支不串状态 | 未开始 |
| **M3 演出可信** | 现有 Provider 只演出既定结果；失败走兜底，不回滚规则 | 未开始 |
| **M4 体验成立** | 首页主 CTA 为「开始这一夜」；桌面/移动端真人能看懂代价并愿意重玩 | 未开始 |
| **M5 运行时选择** | #66 同合同对比后再迁 | **推迟**。合同已写：[PERFORMANCE_RUNTIME.md](PERFORMANCE_RUNTIME.md)。不迁 pi-agent |

M1 试玩入口：`http://127.0.0.1:5176/?night=1`（不烧模型）。不要把 Direct/Crew 提成并列主 CTA。

## 离线验收矩阵（M1 必须）

| 编号 | 条件 |
|---|---|
| G1 | 固定 seed + 六个行动，两遍结果一致 |
| G2 | 非法行动不能改状态；合法行动有条件与效果 |
| G3 | 每回合 NPC 按规则推进；至少一项早期承诺在后续回合返回并指出源头 |
| G4 | 至少三组策略到达不同的、可解释的结局 |

M2+（T1 幂等、T2 断线、D1 分支、A1 兜底、U1 键盘/IME）不在本增量范围。既有 IME / 防重 / 重连测试当回归，不重写。

## 已知口径

- 生产 READY ≠ CI 绿。M0 以 Linux 构建和 pytest 实际启动为准。本机绿、Vercel READY 都不算这道门。
- E2E `FC-1` 在干净 checkout 上预存在红（语言开关藏进设置）。M0 让 e2e 作业在前后端通过后真正跑起来，不把修 FC-1 当本增量。
- eval 默认跳过（`vars.RUN_EVAL`）；缺密钥不得挡住 M0。
- #66 推迟。先用同一份 PerformanceRequest / Result 接现有 Provider；同场景、同失败用例的质量/延迟/成本对比见 [PERFORMANCE_RUNTIME.md](PERFORMANCE_RUNTIME.md)。
