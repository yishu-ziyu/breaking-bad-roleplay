# 演出运行时对比合同（M5 / #66 推迟）

#66（Node / pi-agent sidecar）本轮**不做**。先把同一份演出合同钉死，用现有 Provider 接上；以后用同一批样例比 legacy 与 pi，再决定迁不迁。没有对比证据，不迁。

## 冻结输入：PerformanceRequest

FastAPI 交给演出层的是已经结算好的事实，不是「自由发挥一段剧情」。

```text
PerformanceRequest {
  request_id
  game_id
  turn
  character_id
  language
  resolved_beat {
    event
    player_action
    resolved_effects
    npc_action
    triggered_debts
    visible_state
  }
  character_memory
  intelligence_context
}
```

角色可以决定怎么说、怎么停顿、怎么表达情绪和潜台词。  
角色不能决定：玩家是否成功、压力/人情/信任加减、承诺是否触发、谁离场、下一回合规则事件。

玩家控制沃尔特时，可以润色玩家已经确认的意图，不能擅自替玩家许下一个承诺。

## 冻结输出：PerformanceResult

```text
PerformanceResult {
  character_id
  reply_text
  stage_direction?
  emotion_state?
}
```

禁止出现：`game_state_delta` / `score_delta` / `objective_delta` / `debt_delta` / `world_truth_delta`。  
AI 失败（超时、429、解析错误、进程崩溃）只能走结构化兜底台词，**不得回滚已结算的规则状态**。

## 对比时必须相同的东西

| 固定项 | 含义 |
|---|---|
| 同一份 Request / Result | 两边 ingest / emit 同一 schema，字段不得各写一套 |
| 同一批场景 | 至少：开局厨房（Jesse 上门 / 回家承诺）、Saul 代协调、承诺到期返回。固定 seed + 固定行动序列 |
| 同一批失败 | 超时、429、解析失败、运行时不可用。期望都是兜底继续，规则哈希不变 |
| 同一可见性 | PlayerView 里没有越权秘密；thinking 不进对玩家的流 |

## 以后才比、现在不测的数

质量（人格边界、可见性、错误恢复）、首条有效内容时间、整拍耗时、每完成一局成本、维护面（还要不要自研 tool loop / provider 路由）。  
没有这组数，不把 `AI_RUNTIME=pi` 设成默认，也不删 legacy Provider。

## 本轮明确不做

- 不建 `ai-runtime/`，不引入 pi-agent，不把演出迁到 Node sidecar
- 不改 Director / Provider / 角色 loop 来「提前接好」pi
- 不把 #66 标成进行中。状态：**推迟**，等 M3 现有 Provider 演出稳定之后再开对比

回滚口径（对比完成、若迁）：`AI_RUNTIME=legacy|pi`，legacy 路径保留到对比失败或回滚窗口结束。
