# ABQ 账本

白天经营，晚上圆谎。十六周内攒够 $737,000 干净的钱，别被捕，也别让家散了。

## 结构

```
src/sim/      纯函数内核：没有 DOM，没有网络，没有 Math.random()
  balance.ts  所有数值，改这里调手感
  sim.ts      createGame / step(state, command) / replay(seed, commands)
  stories.ts  沃尔特能说的全部说法（固定词表）+ 对方的问题
src/ai/       Claude 只做两件事：把玩家的话归到某个说法（hear），替对方说话（speak）
src/render/   320×212 的软件光栅器，整数倍放大，像素大小统一
src/ui/       DOM 面板，只读状态、只发指令
scripts/      playtest.ts：脚本玩家跑几百个种子，看结局分布
```

规则：AI 永远不写状态。`hear()` 返回的 id 会被 sim 重新校验，不在词表里就算"岔开话题"；判定（信了 / 矛盾 / 被拆穿）只由 `judge()` 算，`speak()` 只能照着判定说台词。

存档就是 `{ seed, commands }`，回放得到同一局。

## 命令

```
npm run dev        本地开发
npm test           内核单测
npm run playtest   平衡测试（greedy / careful / confess / random 四种脚本玩家）
npm run build      产出 dist/abq-ledger.html（单文件，可直接发布成 Artifact）
```
