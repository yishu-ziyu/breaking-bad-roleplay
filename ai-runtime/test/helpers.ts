import type { PerformanceRequest } from "../src/contracts.ts"

export function beatRequest(overrides: Partial<PerformanceRequest> = {}): PerformanceRequest {
  return {
    request_id: overrides.request_id ?? "req-1",
    game_id: overrides.game_id ?? "game-a",
    turn: overrides.turn ?? 1,
    character_id: "walter",
    language: overrides.language ?? "en",
    resolved_beat: overrides.resolved_beat ?? {
      player_action: { id: "lie_to_skyler" },
      resolved_effects: [{ field: "family_suspicion", delta: -1 }],
      npc_actions: [{ npc_id: "skyler", action_id: "go_to_bed" }],
      triggered_debts: [],
      visible_state: {
        police_risk: 2,
        family_suspicion: 1,
        jesse_trust: 3,
        cash: 400,
      },
    },
    character_memory: overrides.character_memory ?? { note: "kitchen lie" },
    provider: overrides.provider,
  }
}
