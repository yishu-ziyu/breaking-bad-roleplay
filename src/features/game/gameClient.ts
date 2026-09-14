/** M1: in-process kernel. M2 replaces this with the command API. */

import { applyAction, playerView, startRun, type GameState } from './kernel.ts'
import type { ApplyResult, PlayerView } from './contracts.ts'

export function createLocalGame(seed = 1): {
  snapshot: () => PlayerView
  act: (choiceId: string) => ApplyResult
} {
  let state: GameState = startRun(seed)
  return {
    snapshot: () => playerView(state),
    act: (choiceId: string) => {
      const [next, error] = applyAction(state, choiceId)
      if (error) return { view: playerView(state), error }
      state = next
      return { view: playerView(state), error: null }
    },
  }
}
