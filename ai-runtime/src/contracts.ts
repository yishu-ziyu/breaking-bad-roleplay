export const ALLOWED_TOOLS = [
  "get_visible_game_state",
  "get_character_memory",
  "search_materials",
] as const

export const FORBIDDEN_TOOLS = [
  "bash",
  "powershell",
  "edit",
  "write",
  "read",
  "grep",
  "find",
  "ls",
  "commit_game_state",
  "update_score",
  "change_debt",
] as const

export const FORBIDDEN_RESULT_KEYS = [
  "game_state_delta",
  "score_delta",
  "objective_delta",
  "debt_delta",
  "world_truth_delta",
] as const

export type CharacterId = "walter"

export type ResolvedBeat = {
  event?: Record<string, unknown>
  player_action?: Record<string, unknown>
  resolved_effects?: unknown[]
  npc_action?: unknown[]
  npc_actions?: unknown[]
  triggered_debts?: unknown[]
  visible_state?: Record<string, unknown>
}

export type PerformanceRequest = {
  request_id: string
  game_id: string
  turn: number
  character_id: CharacterId
  language: "en" | "zh"
  resolved_beat: ResolvedBeat
  character_memory?: unknown
  intelligence_context?: unknown
  provider?: {
    provider_id?: string
    model_id?: string
    api_key?: string
    base_url?: string
  }
}

export type PerformanceResult = {
  character_id: CharacterId
  reply_text: string
  stage_direction?: string
  emotion_state?: string
  source: "pi" | "faux" | "fallback"
}

export type PublicStreamEvent =
  | { type: "content"; text: string }
  | { type: "status"; text: string }
  | { type: "done" }

export type SessionKey = string

export function sessionKey(gameId: string, characterId: string): SessionKey {
  return `${gameId}::${characterId}`
}

export function assertPerformanceResult(value: unknown): PerformanceResult {
  if (!value || typeof value !== "object") {
    throw new Error("PerformanceResult must be an object")
  }
  const row = value as Record<string, unknown>
  for (const key of FORBIDDEN_RESULT_KEYS) {
    if (key in row) {
      throw new Error(`PerformanceResult must not include ${key}`)
    }
  }
  if (typeof row.reply_text !== "string" || !row.reply_text.trim()) {
    throw new Error("PerformanceResult.reply_text required")
  }
  return {
    character_id: "walter",
    reply_text: row.reply_text,
    stage_direction: typeof row.stage_direction === "string" ? row.stage_direction : undefined,
    emotion_state: typeof row.emotion_state === "string" ? row.emotion_state : "tense",
    source: row.source === "pi" || row.source === "faux" ? row.source : "fallback",
  }
}
