export type Language = 'en' | 'zh'

export type GameMeter = {
  police_risk: number
  family_suspicion: number
  jesse_trust: number
  cash: number
  saul_favor: number
  turn: number
}

export type GameAction = {
  id: string
  label: string
  label_zh?: string
  costs: Record<string, number>
  summary?: string
  summary_zh?: string
  requirements?: Array<Record<string, unknown>>
}

export type GameEffect = {
  field?: string
  delta?: number
  source?: string
  reason?: string
  remove?: string
  add?: string
  debt_id?: string
  value?: unknown
  key?: string
}

export type NpcAction = {
  npc_id: string
  action_id: string
  summary: string
}

export type Debt = {
  id: string
  countdown?: number
  severity?: number
  summary?: string
}

export type GameEvent = {
  id: string
  title: string
  title_zh?: string
  text: string
  text_zh?: string
  turn?: number
  remaining?: number
}

export type GameEnding = {
  id: string
  kind: 'win' | 'loss' | 'cost'
  title: string
  title_zh?: string
  text: string
  text_zh?: string
}

export type GameState = GameMeter & {
  game_id: string
  seed: number
  open_problems: string[]
  debts: Debt[]
  npc_state: Record<string, Record<string, unknown>>
  objective_state: Record<string, string>
  flags: string[]
  ended: boolean
  ending: GameEnding | null
}

export type Performance = {
  character_id: string
  reply_text: string
  stage_direction?: string
  emotion_state?: string
  source?: string
}

export type GameResponse = {
  game_id: string
  state: GameState
  visible_state?: GameState
  event: GameEvent
  available_actions: GameAction[]
  ending: GameEnding | null
  performance?: Performance
  previous_state?: GameState
  action?: GameAction
  resolved_effects?: GameEffect[]
  npc_actions?: NpcAction[]
  triggered_debts?: Debt[]
  next_state?: GameState
  next_event?: GameEvent
}
