# P0 网络恢复闭环 — 交付报告（2026-09-18）

基线：当前未提交工作树（`55df802` + P0 未提交改动）。本轮**未 commit、未 push、未迁移生产库、未 deploy**。

范围：只修「生成中断线重连竞态」「Action ACK 不确定」「connectionState ref 统一」「Stop 语义」四件事。不动首页，不扩到 Crew 抢话或新功能。

## 1. 修了什么

| 问题 | 现状（改前） | 现在 |
|---|---|---|
| 生成中重连 | 旧 stream 仍持有 generation token 时，新 stream 从 `claim_turn` 收到 409 `turn_in_progress`，前端当普通 HTTP 错误弹错误页 | 识别 `detail.code === "turn_in_progress"`：不建新 command、不重新 POST、不额外扣额度；按 800ms→1.6s→3.2s→5s 上限退避（最多 6 次，约 20s），每次先查 `GET /api/session/{id}/state`，再连同一个 command；committed 后免费回放 outbox |
| ACK 不确定 | POST 前乐观插入 `player_turn`，网络异常后不删；用户可换一句覆盖 `pendingCommandRef`，旧行动永久悬空 | 网络异常/5xx 时用**原 command_id** 查 `/state`：`pending` → 自动接上；`committed` → 从 outbox 恢复并按 `event_id` 去重；`absent` → 用同一 command_id 自动重发一次；`unknown`（探测失败）→ 进入有上限的退避循环。未确认前不接受不同 action，未确认的 player_turn 标 `pending`，确认不存在时删除，不留在正文里 |
| connectionState ref | `reconnect()` 直接 `setConnectionState`，ref 慢一帧；流立即关闭被当失败 | 全部改走 `updateConnectionState`（含 mount 探测路径）；`connecting` 与 `streaming` 一样给一次静默重连，手动重连后连接立即关闭不再弹错误页 |
| Stop | 前端删本地 session，后端仅 `status=paused`；未提交 command 仍可能被 commit 或恢复，in-flight 生成器拿不到退款 | 新服务层原语 `story/service.py:stop_turn`：锁 session、失效 generation token、清 `pending_command_id`、`status="stopped"`；已提交的 world snapshot / revision / messages / lineage 全部保留。`release_turn` 改为以持久化的 `StoryTurn.events` 判定退款，stop 后 in-flight 生成器退出时**恰好退一次** |

`Stop` 与 `commit` 并发的两种顺序（均由 `commit_turn` 的锁内复检决定）：

- commit 先完成 → 该 committed turn 保留，随后 stop 只把 session 收尾为 `stopped`。
- stop 先完成 → `commit_turn` 抛 `claim_lost`，候选永远不落库（`events` 保持 NULL，不进 lineage）；再取同一个 command 报 `story_paused`。

## 2. 新增测试

前端单测（`npx tsx --test`）：

- `src/lib/storyRecovery.test.ts`：`turnRetryDelay (bounded backoff, never an endless loop)`（2）、`classifyCommandReality (old generator vs committed outbox)`（6）、`transportEndVerdict (manual reconnect must not pop the error card)`（3），共 11。
- `src/lib/storyFeed.test.ts`：`settleCommandEvents (an unconfirmed move is never committed text)`（3）。
- `src/lib/storyReading.test.ts`：`pending player text (P0 unconfirmed acknowledgement)`（2）。

后端（`backend/tests/test_story_stop.py`，11）：

- `test_stop_abandons_pending_command_and_keeps_committed_history`
- `test_late_commit_after_stop_is_rejected_and_change_never_lands`
- `test_commit_that_finishes_before_stop_is_kept`
- `test_stopped_session_cannot_be_reclaimed_or_replayed`（第二轮更新：stop 后重发 cancelled command_id 现在也是 409 story_stopped，不再 200 replayed）
- `test_stop_blocks_every_mutating_action`（第二轮新增）
- `test_stopped_session_still_serves_committed_history`（第二轮新增）
- `test_release_after_stop_signals_exactly_one_refund`
- `test_stop_endpoint_keeps_history_and_blocks_the_cancelled_command`（第二轮更新）
- `test_stop_during_generation_refunds_the_beat_exactly_once`
- `test_action_after_stop_cannot_reopen_the_run`（第二轮新增）
- `test_stop_blocks_a_fresh_command_id_endpoint`（第二轮新增，含只读 replay 仍 200）

E2E：

- `tests/e2e/network-recovery.spec.ts`（新，4）
  - `a reconnect that finds the old generator still running waits, then replays the committed beat`
  - `a lost action acknowledgement keeps the original move and refuses a different one`
  - `a manual reconnect that closes before any event retries instead of showing an error`
  - `Stop abandons the uncommitted command, returns to idle, and never auto-resumes`
- `tests/e2e/reliable-story-memory.spec.ts`：原 `an uncertain action acknowledgement reuses the original id on retry` 拆成两条，对应当前契约
  - `an uncertain action acknowledgement resolves itself without a second command`（客户端自己接上原 command，玩家不需要再发一次）
  - `a command the server never received is re-sent with the same id`（服务端确认未收到 → 同一 command_id 自动重发）

契约变更说明：旧用例要求「玩家手动重发同一句话，客户端复用同一 id」。P0 要求 2.3 明确要求客户端自动接上 pending command，因此该路径下玩家不再需要重发；「复用同一 id」的意图由第二条用例（服务端确认未收到）保留。mock 同时修正了一处失真：`/action` 现在回传本次请求的 `command_id`（原实现回传服务端最后一条，与实际后端不符）。

## 3. 网络竞态怎么被模拟

`tests/e2e/network-recovery.spec.ts` 用一个可编排的假后端，而不是随机断网：

- `setHolds(n)` / `release()`：`/stream` 在还有 hold 时返回 `409 {detail:{code:"turn_in_progress", world_revision}}`，模拟「旧 stream 仍持 token」；hold 用尽后同一个 command 返回 committed outbox（`eventsFor` 带 `event_id = "<command>:<index>"`）。
- `loseFirstAck`：`/action` 先记录 command 再 `route.abort('failed')`，模拟「服务端已接受、ACK 丢失」。
- `loseAckWithoutRecording`：`/action` 直接 abort 且不记录，`/state` 里该 command 既不是 pending 也不是 last，模拟「服务端从未收到」，用来验证同一 command_id 的自动重发（这个 knob 在 `network-recovery.spec.ts` 与 `reliable-story-memory.spec.ts` 都在用）。
- `failNextActionWith502`：`/action` 先记录 command，再返回 502 —— 服务端已经收下，只是没能答复。
- `plantPending(id, text)`：模拟「另一个标签页已经在该 session 上入队了 command-A」；本标签页再提交 command-B 会得到真实的 409 `turn_in_progress`。
- `delayNextState(ms)`：只延迟下一次 `/state` 响应，用来制造「旧 command 的探测答复晚到」。
- `failNextStops(n)`：Stop 的 POST 连续 abort n 次，用来验证「停止尚未确认」。
- `generated` / `replayed` 分开计数：generated 才是真正生成的（计费）那一次，replayed 是 committed outbox 的免费回放。
- 手动重连：局部 route 先连续 `route.abort('failed')` 让 UI 进入中断态，再对一个空 body 的 200 响应触发「连接立即关闭」。
- 请求计数（`actions` / `billed` / `conflicts` / `stateProbes`）就是断言依据：`actions.length === 1` 即「只创建了一个 command」。

## 4. 额度

- `claim_turn` 仍在断言之后：409 `turn_in_progress` 不会走到计费，重连成功后 `claim.saved_events is not None` 直接回放，不再计费。E2E 断言同一 command 只被计费一次（`billed` 里只有一个）。
- Stop：`release_turn` 现在按持久化 `StoryTurn.events` 判定，stop 后 in-flight 生成器退出返回 True，HTTP 层 `_schedule_quota_refund` 调用一次；`claim.released` 粘滞 + 提交后 `turn.events` 非空，保证**只退一次**。`test_stop_during_generation_refunds_the_beat_exactly_once` 断言 `refund.call_count == 1`，且之后的 `/stream` 是 409、不再计费。

## 5. 测试数字（2026-09-18，未提交工作树）

| 检查 | 命令 | 结果 |
|---|---|---|
第三次（终稿）在**冻结快照**上串行测得，快照内容指纹 `2b224cceef2844b2`（487 文件；活树当时有第二个会话在写，不能作为验收面）：

| 前端单测 | `npm test` | **231 passed / 0 failed**（45 suites） |
|---|---|---|
| 后端 | `npm run test:backend` | **730 passed / 0 failed**（2 个既有依赖告警） |
| E2E 默认 | `npx playwright test` | **69 passed / 3 skipped / 0 failed**（含 13 条 network-recovery；跳过的是需显式假 Supabase 的 Auth 契约） |
| E2E Auth | `npm run test:e2e:auth` | **3 passed / 0 failed** |
| 构建 | `npm run build` | 通过（保留既有 >500 kB 提示，非本轮） |
| Lint | `npm run lint` | exit 0，0 error / 0 warning（与 `npm run build` 并发跑时 eslint 遍历会在刚写入的 `dist/` 上抛错，必须串行） |
| Ruff | `uv run ruff check` 全部 29 个改动/新增 Python 文件 | All checks passed |
| 空白 | `git diff --check` | 通过 |
| 迁移 | `cd backend && uv run alembic upgrade head --sql` | 通过，链到 head `i9j0k1l2m3n4`，14 张 CREATE TABLE |

本轮新增/改动的用例数：前端 +20（storyRecovery 12、storyFeed 4、storyReading 2、storyCommands 2），后端 +11（test_story_stop.py，含第二轮 4 条新增、2 条更新），E2E 新增 13 条（`network-recovery.spec.ts`）并把 3 条旧契约更新到当前行为（`reliable-story-memory.spec.ts` 2 条、`current-interactions.spec.ts` 1 条）。

两条既有 E2E 契约随行为一起更新（不是放宽断言）：

- `reliable-story-memory.spec.ts`：「ACK 丢失后玩家手动重发、客户端复用同一 id」拆成「客户端自己接上原 command」+「服务端确认未收到时用同一 id 自动重发」。前者在 P0 要求 2.3 下已不需要人工重发。
- `current-interactions.spec.ts`：「流无终止事件时立即报错」改为「先静默重连一次，第二次仍失败才报错，且不会出现第三次尝试」——中断态判定不变（不会永久转圈），只是多了一次有上限的重试。

## 5.1 独立复核后的第二轮修复（同一天）

独立复核判定 release-blocking，列出 6 个 High / 2 个 Medium / 2 个 Low。已修的部分：

| 复核项 | 结论 | 现在的做法 | 证据 |
|---|---|---|---|
| H1 Stop 先完成，迟到 action 仍可重开 session | 真问题 | `enqueue_turn` 在拿到行锁后、幂等查询与所有其他检查之前就抛 `story_stopped`；stopped session 的 act / continue / redirect / branch / continue_chapter / switch_perspective、新 command_id、旧 cancelled command_id 一律 409；`replay` 仍只读、不建 command | `test_stop_blocks_every_mutating_action`、`test_stop_blocks_a_fresh_command_id_endpoint`、`test_action_after_stop_cannot_reopen_the_run` |
| H2 Stop 不看服务端是否接受就清 session | 真问题 | Stop 立即关 SSE，然后有上限重试（500ms/1s/2s）+ 用 `/state` 复核；只有确认 `status=stopped`（或 404/409/已停止）才清 storage。未确认时保留 session key，显示「停止尚未确认」，可再点一次 | `test_stop_is_retried_and_only_clears_the_session_once_the_server_confirms`、`test_stop_is_retried_...`（见 §2 用例名）、`test_an_unconfirmed_stop_keeps_the_session_key_and_says_so` |
| H3 乐观 player_turn 结算方向相反 | 真问题 | `settleCommandEvents` 改成三态：`committed` 原地转正、`absent` 删除、`pending` 原样保留（服务端持有并仍在生成 ≠ 没发生）。任何带 `command_id` 的 SSE 事件（已提交）都会立刻转正，不再永久停在 `--pending` | `storyFeed.test.ts` 4 条、`storyReading.test.ts` 2 条、E2E「ACK 丢失后 pending 标记先留着、提交后消失」 |
| H4 /action 5xx 不走进不确定 ACK | 真问题 | 500–599 与网络异常同一路径：保留原 command_id 与原 body、`player_turn` 保持 pending、查 `/state`，pending→连接、committed→回放、absent→同 ID 重发一次、unknown→有上限退避 | `test_a_502_on_the_action_is_treated_as_an_uncertain_acknowledgement_and_finishes_the_move` |
| H5 手动重连没有新的静默重试预算；旧 E2E 是假阳性 | 真问题 | `reconnect()` 重置静默重连预算；E2E 改成「中断态 → 点重试演出 → 第一次响应空 body 立即关闭 → 静默再连 → 拿到 beat」，并断言真的发生了两次 stream 请求 | `test_a_manual_reconnect_that_closes_before_any_event_retries_instead_of_showing_an_error` |
| H6 恢复绑错 command | 真问题 | 不确定 ACK 时 `commandRef` 立刻切到待恢复的 command；`beat_ready` 只在 command_id 匹配时才清 `pendingCommandRef`（旧拍回放不再吞掉新行动）；新 action 收 409 时按 `/state` 的 `pending_command_id`/`command_id` 接管（`adoptServerCommand`），并把 connectionState 切到 `connecting` | `test_a_refused_action_follows_the_command_another_tab_already_started` |
| M1 恢复任务不是 command-scoped | 真问题 | 每个 command 一套：`activeRecoveryCommandRef`（谁拥有恢复；旧 `/state` 响应晚到直接判 `stale`，不改 ref/notice/状态）、`turnRetryCommandRef`（预算按 command 重置）、`autoResendCommandRef`（替代裸 boolean，且 resend 前再验 `pendingCommandRef.current.body.command_id === commandId`）、`recoveryEpochRef`（reset/stop 作废在途探测） | `test_a_late_state_answer_for_an_old_command_cannot_touch_the_newer_one` |

### 5.2 第二轮复核后的第三轮修复

第二轮独立复核（冻结快照复核）判定仍 release-blocking：4 条客户端竞态 + 1 条文档夸大。已全部处理：

| 复核项 | 现在的做法 | 证据 |
|---|---|---|
| F1 `/action` 半开连接可永久卡在无流的 `streaming` | POST 有 20s deadline（`ACTION_DEADLINE_MS`），超时按「不确定 ACK」处理：abort → 查 `/state` → 接同一 command，不再停在只有转圈的 streaming | `an action POST that never answers recovers instead of spinning forever` |
| F2 Stop 开始时未作废在途 recovery，旧 `/state` 可在 Stop 后重开 SSE | Stop 第一件事就是 `recoveryEpochRef += 1` + 清 `activeRecoveryCommandRef`，然后立刻关 SSE；`probeStorySnapshot` 接受 AbortSignal，Stop 的 `/state` 复核与重试都可被新的 Stop/新 action 打断；卸载同样递增 epoch | `Stop invalidates a recovery that is already in flight`（延迟 3s 的旧响应到达后不再开流） |
| F3 自动 resend 的 ACK 再丢一次就停止恢复 | resend 失败不再只弹 notice：立即进入有上限的 `/state` 轮询，pending 就接上、committed 就回放 | `a lost acknowledgement on the automatic resend still finishes the move` |
| F3b 首个 5xx 分支没切 `commandRef` | 5xx 与网络异常现在都把 `commandRef` 指向正在恢复的 command | 同上 + `a 502 on the action ...` |
| F4 409 接管用两次 `/state`，第二次失败会停在无流的 `connecting` | `adoptServerCommand` 复用首次 `/state` 快照（`recoverTurn` 新增 `snapshot` 选项，不再二次探测）；reality 为 absent 时回到 `beat_paused`，不会停在 connecting | 跨标签页用例新增断言：被拒 action 与目标 stream 之间**只有一次** `/state` |
| F5「beat_ready 只在 command_id 匹配时清 pending」与代码不符（`null` 也会清） | 改为：只有 command_id 完全一致（或本地也没有 command_id 的 legacy 情况）才清 | 代码 + 既有回归 |

使用过的修复验证：第二轮复核报告的 F1/F2/F3/F4/F5 均已逐条复现并覆盖测试；复核确认无新的双扣/双退。

已知限制（本轮不修，如实记录）：

- M2「5 分钟 token 接管后旧 attempt 拿不到退款」：`release_turn` 只能从 `StoryTurn.events` 判断该 command 是否已提交，无法区分「我提交的（取消窗口）」和「另一个 claim 接管后提交的」。要点：只有旧 stream 超过 5 分钟没有任何心跳续约（即请求已经僵死）才会被接管；后果是那一次 5 credits 不退，**不会重复退款**。彻底修需要按 attempt 记账（`story_turns` 上记录提交所用的 token 或独立 attempt 表），属于新的迁移，不在本轮范围。

## 6. 未做

- 未部署、未 commit、未 push、未跑生产 smoke。
- Crew 抢话、语音打断、真实并发压测不在本轮。
