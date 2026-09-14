import scenarioJson from './one_night.json' with { type: 'json' }
import type { GameActionChoice, GameEnding, GameHistoryItem, PlayerView } from './contracts.ts'

type Scenario = typeof scenarioJson
type ActionSpec = Scenario['actions'][number]
type PromiseRec = {
  id: string
  owed_to: string
  due_turn: number
  source_action_id: string | null
  label: string
  overdue_log: string
  overdue?: Record<string, unknown>
  resolved?: boolean
  triggered?: boolean
}

const SCENARIO = scenarioJson
const TURNS = SCENARIO.turns
const METER_BOUNDS = Object.fromEntries(
  Object.entries(SCENARIO.meters).map(([name, spec]) => [name, [spec.min, spec.max] as const]),
)

export type GameState = {
  run_id: string
  seed: number
  revision: number
  turn: number
  meters: Record<string, number>
  resources: Record<string, number>
  location: string
  flags: Record<string, unknown>
  known: string[]
  promises: PromiseRec[]
  fired_npc: string[]
  log: Array<{
    source: string
    text: string
    action_id?: string | null
    label?: string
    turn: number
  }>
  scene: { speaker: string; body: string }
  last_consequence: string
  ending: GameEnding | null
  last_actions: GameActionChoice[]
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function clampMeter(name: string, value: number): number {
  const bounds = METER_BOUNDS[name]
  if (!bounds) return value
  return Math.max(bounds[0], Math.min(bounds[1], value))
}

function promiseOf(state: GameState, pid: string): PromiseRec | undefined {
  return state.promises.find((item) => item.id === pid)
}

function promiseOpen(state: GameState, pid: string): boolean {
  const found = promiseOf(state, pid)
  return Boolean(found) && !found?.resolved
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function matches(when: unknown, state: GameState): boolean {
  const clause = asRecord(when)
  if (Object.keys(clause).length === 0) return true
  for (const [key, expected] of Object.entries(asRecord(clause.flag_eq))) {
    if (state.flags[key] !== expected) return false
  }
  for (const [key, options] of Object.entries(asRecord(clause.flag_in))) {
    if (!Array.isArray(options) || !options.includes(state.flags[key])) return false
  }
  for (const [key, minimum] of Object.entries(asRecord(clause.resource_gte))) {
    if ((state.resources[key] ?? 0) < Number(minimum)) return false
  }
  const known = clause.known
  if (Array.isArray(known)) {
    for (const fact of known) {
      if (typeof fact === 'string' && !state.known.includes(fact)) return false
    }
  }
  if ('location' in clause && state.location !== clause.location) return false
  if ('promise_open' in clause && typeof clause.promise_open === 'string' && !promiseOpen(state, clause.promise_open)) {
    return false
  }
  if (
    'promise_missing' in clause &&
    typeof clause.promise_missing === 'string' &&
    promiseOpen(state, clause.promise_missing)
  ) {
    return false
  }
  if ('promise_resolved' in clause && typeof clause.promise_resolved === 'string') {
    const found = promiseOf(state, clause.promise_resolved)
    if (!found?.resolved) return false
  }
  for (const [key, minimum] of Object.entries(asRecord(clause.meter_gte))) {
    if ((state.meters[key] ?? 0) < Number(minimum)) return false
  }
  for (const [key, maximum] of Object.entries(asRecord(clause.meter_lte))) {
    if ((state.meters[key] ?? 0) > Number(maximum)) return false
  }
  return true
}

function legalDefs(state: GameState): ActionSpec[] {
  const matched = SCENARIO.actions.filter((action) => matches(action.when, state))
  if (matched.length <= 3) return matched
  const without = matched.filter((action) => action.id !== 'stall')
  if (without.length >= 3) return without.slice(0, 3)
  const stall = matched.filter((action) => action.id === 'stall')
  return [...without, ...stall].slice(0, 3)
}

function appendLog(
  state: GameState,
  opts: {
    source: string
    text: string
    actionId?: string | null
    label?: string
    actedOnTurn?: number
  },
): void {
  if (!opts.text) return
  state.log.push({
    source: opts.source,
    text: opts.text,
    action_id: opts.actionId,
    label: opts.label ?? '',
    turn: opts.actedOnTurn ?? state.turn,
  })
}

function applyEffects(
  state: GameState,
  effects: unknown,
  opts: { source: string; actionId?: string | null; label?: string; actedOnTurn?: number },
): void {
  const body = asRecord(effects)
  if (Object.keys(body).length === 0) return
  for (const [name, delta] of Object.entries(asRecord(body.meters))) {
    state.meters[name] = clampMeter(name, (state.meters[name] ?? 0) + Number(delta))
  }
  for (const [name, delta] of Object.entries(asRecord(body.resources))) {
    state.resources[name] = Math.max(0, (state.resources[name] ?? 0) + Number(delta))
  }
  for (const [name, value] of Object.entries(asRecord(body.flags))) {
    state.flags[name] = value
  }
  if ('location' in body) state.location = String(body.location)
  const known = body.known
  if (Array.isArray(known)) {
    for (const fact of known) {
      if (typeof fact === 'string' && !state.known.includes(fact)) state.known.push(fact)
    }
  }
  if (typeof body.resolve_promise === 'string') {
    const found = promiseOf(state, body.resolve_promise)
    if (found) found.resolved = true
  }
  const delay = asRecord(body.delay_promise)
  if (typeof delay.id === 'string') {
    const found = promiseOf(state, delay.id)
    if (found && !found.resolved) {
      found.due_turn = Number(found.due_turn ?? 0) + Number(delay.by ?? 0)
    }
  }
  const created = asRecord(body.create_promise)
  if (typeof created.id === 'string' && !promiseOf(state, created.id)) {
    const item = clone(created) as PromiseRec
    item.resolved = false
    item.triggered = false
    if (opts.actionId && !item.source_action_id) item.source_action_id = opts.actionId
    state.promises.push(item)
  }
  const scene = asRecord(body.scene)
  if (typeof scene.body === 'string') {
    state.scene = { speaker: String(scene.speaker ?? ''), body: scene.body }
  }
  appendLog(state, {
    source: opts.source,
    text: String(body.log ?? ''),
    actionId: opts.actionId,
    label: opts.label,
    actedOnTurn: opts.actedOnTurn,
  })
}

function applyBlock(
  state: GameState,
  spec: { label?: string; effects?: unknown; effects_if?: unknown },
  opts: { source: string; actionId?: string | null; actedOnTurn?: number },
): void {
  const label = spec.label ?? ''
  applyEffects(state, spec.effects, { ...opts, label })
  const extras = Array.isArray(spec.effects_if) ? spec.effects_if : []
  for (const extra of extras) {
    const row = asRecord(extra)
    if (matches(row.when, state)) applyEffects(state, extra, { ...opts, label })
  }
}

function runNpcs(state: GameState): void {
  for (const step of SCENARIO.npc_steps) {
    if (step.once && state.fired_npc.includes(step.id)) continue
    if (!matches(step.when, state)) continue
    applyEffects(state, step.effects, { source: 'npc' })
    if (step.once) state.fired_npc.push(step.id)
  }
}

function runPromises(state: GameState): void {
  for (const item of state.promises) {
    if (item.resolved || item.triggered) continue
    if (state.turn < Number(item.due_turn ?? 0)) continue
    item.triggered = true
    applyEffects(state, 'overdue' in item ? item.overdue : undefined, { source: 'promise' })
    appendLog(state, { source: 'promise', text: String(item.overdue_log ?? '') })
  }
}

function endingCauses(state: GameState): GameEnding['causes'] {
  const out: GameEnding['causes'] = []
  const seen = new Set<string>()
  for (const entry of state.log) {
    if (entry.source !== 'player' || !entry.action_id) continue
    const key = `${entry.turn}:${entry.action_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      turn: entry.turn,
      action_id: entry.action_id,
      label: entry.label ?? '',
    })
  }
  return out
}

function evaluateEnding(state: GameState): GameEnding | null {
  for (const spec of SCENARIO.endings) {
    if (!spec.hard || !matches(spec.when, state)) continue
    return { id: spec.id, title: spec.title, body: spec.body, causes: endingCauses(state) }
  }
  if (state.turn <= TURNS) return null
  for (const spec of SCENARIO.endings) {
    if (spec.hard) continue
    if (!matches(spec.when, state)) continue
    return { id: spec.id, title: spec.title, body: spec.body, causes: endingCauses(state) }
  }
  return null
}

function toChoices(defs: ActionSpec[]): GameActionChoice[] {
  return defs.map((action) => ({ id: action.id, label: action.label, cost_text: action.cost_text }))
}

function visibleHistory(state: GameState): GameHistoryItem[] {
  const specs = Object.fromEntries(SCENARIO.actions.map((action) => [action.id, action]))
  const out: GameHistoryItem[] = []
  const seen = new Set<string>()
  for (const entry of state.log) {
    if (entry.source !== 'player' && entry.source !== 'npc' && entry.source !== 'promise') continue
    const text = entry.text.trim()
    if (!text) continue
    if (entry.source === 'player') {
      const key = `${entry.turn}:${entry.action_id ?? ''}`
      if (seen.has(key)) {
        const match = [...out].reverse().find(
          (item) => item.source === 'player' && item.turn === entry.turn && item.action_id === entry.action_id,
        )
        if (match) match.text = `${match.text} ${text}`.trim()
        continue
      }
      seen.add(key)
      const spec = entry.action_id ? specs[entry.action_id] : undefined
      out.push({
        turn: entry.turn,
        source: 'player',
        text,
        action_id: entry.action_id,
        label: entry.label || spec?.label || '',
        cost_text: spec?.cost_text ?? '',
      })
      continue
    }
    out.push({
      turn: entry.turn,
      source: entry.source,
      text,
      action_id: entry.action_id,
      label: entry.label ?? '',
      cost_text: '',
    })
  }
  return out
}

export function startRun(seed = 1): GameState {
  const meters = Object.fromEntries(
    Object.entries(SCENARIO.meters).map(([name, spec]) => [name, spec.start]),
  )
  const resources = Object.fromEntries(
    Object.entries(SCENARIO.resources).map(([name, spec]) => [name, spec.start]),
  )
  return {
    run_id: `night-${seed}`,
    seed,
    revision: 0,
    turn: 1,
    meters,
    resources,
    location: SCENARIO.location_start,
    flags: clone(SCENARIO.flags_start),
    known: [],
    promises: clone(SCENARIO.promises_start),
    fired_npc: [],
    log: [],
    scene: clone(SCENARIO.opening_scene),
    last_consequence: '',
    ending: null,
    last_actions: [],
  }
}

export function fingerprint(state: GameState): string {
  return JSON.stringify({
    seed: state.seed,
    revision: state.revision,
    turn: state.turn,
    meters: state.meters,
    resources: state.resources,
    location: state.location,
    flags: state.flags,
    known: state.known,
    promises: state.promises,
    fired_npc: state.fired_npc,
    log: state.log,
    ending: state.ending,
  })
}

export function applyAction(state: GameState, actionId: string): [GameState, string | null] {
  const next = clone(state)
  if (next.ending) return [state, 'already_ended']
  const spec = legalDefs(next).find((action) => action.id === actionId)
  if (!spec) return [state, 'illegal_action']
  const actedOn = next.turn
  applyBlock(next, spec, { source: 'player', actionId, actedOnTurn: actedOn })
  next.turn += 1
  next.revision += 1
  runNpcs(next)
  runPromises(next)
  next.ending = evaluateEnding(next)
  next.last_actions = toChoices(legalDefs(next))
  next.last_consequence = next.log
    .filter((entry) => entry.turn === actedOn)
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(' ')
  return [next, null]
}

export function playerView(state: GameState): PlayerView {
  const labels = asRecord(SCENARIO.location_labels)
  const legal =
    state.last_actions.length > 0
      ? state.last_actions
      : toChoices(legalDefs(state))
  const promises = state.promises
    .filter((item) => !item.resolved)
    .map((item) => ({
      id: item.id,
      label: item.label,
      due_turn: item.due_turn ?? null,
      source_action_id: item.source_action_id ?? null,
    }))
  return {
    run_id: state.run_id,
    revision: state.revision,
    turn: state.ending ? TURNS : Math.min(state.turn, TURNS),
    turns_max: TURNS,
    location: state.location,
    location_label: String(labels[state.location] ?? state.location),
    player: SCENARIO.player,
    objective: SCENARIO.objective,
    meters: { ...state.meters },
    resources: { ...state.resources },
    promises,
    known: [...state.known],
    scene: { ...state.scene },
    last_consequence: state.last_consequence,
    legal_actions: state.ending ? [] : legal,
    ending: state.ending ? clone(state.ending) : null,
    history: visibleHistory(state),
  }
}
