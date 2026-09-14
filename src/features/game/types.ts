/** Authoritative night API types. Resources and outcomes come from the server. */

export type GameActionChoice = {
  id: string
  label: string
  cost_text: string
}

export type GamePromiseView = {
  id: string
  label: string
  due_turn: number | null
  source_action_id: string | null
}

export type GameEnding = {
  id: string
  title: string
  body: string
  causes: Array<{ turn: number; action_id: string; label: string }>
}

export type GameHistoryItem = {
  turn: number
  source: string
  text: string
  action_id?: string | null
  label?: string
  cost_text?: string
}

export type PlayerView = {
  run_id: string
  revision: number
  turn: number
  turns_max: number
  location: string
  location_label: string
  player: string
  objective: string
  meters: Record<string, number>
  resources: Record<string, number>
  promises: GamePromiseView[]
  known: string[]
  scene: { speaker: string; body: string }
  last_consequence: string
  legal_actions: GameActionChoice[]
  ending: GameEnding | null
  history?: GameHistoryItem[]
  visibility?: 'player'
  performance?: { revision: number; text: string; source: 'fallback' | 'model' } | null
}

export type ActionCommand = {
  action_id: string
  expected_revision: number
  choice_id: string
}

export type GameEvent = {
  seq: number
  run_id: string
  revision: number
  type: string
  visibility: string
  source_action_id?: string | null
  payload?: Record<string, unknown>
}

export type GameApiError = {
  code: string
  message: string
  view?: PlayerView
}
