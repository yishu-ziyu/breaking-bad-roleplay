import type { ResolvedBeat } from "../contracts.ts"

export function getVisibleGameState(beat: ResolvedBeat): string {
  return JSON.stringify(beat.visible_state ?? {}, null, 2)
}

export function visibleGameStateTool(beat: ResolvedBeat) {
  return {
    name: "get_visible_game_state" as const,
    description: "Read the already-committed visible GameState. Read-only.",
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      content: [{ type: "text" as const, text: getVisibleGameState(beat) }],
      details: { readonly: true },
    }),
  }
}
