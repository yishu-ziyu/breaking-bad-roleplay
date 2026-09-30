# ABQ 账本 · Agent 须知

动手之前先读 [DESIGN.md](DESIGN.md)，特别是第 4 节和第 7 节。

- AI 只能"听"（`hear`）和"说"（`speak`），不能写游戏状态。所有判定都在 `src/sim/sim.ts` 的 `judge()` 里。
- sim 里不准用 `Math.random()`，一律用 `roll(s)`。
- 改了 `balance.ts` 就跑 `npm run playtest`，再把结果写回 DESIGN.md 第 5 节。
- 提交前跑 `npm run typecheck && npm test && npm run build`。
