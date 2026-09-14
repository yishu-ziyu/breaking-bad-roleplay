import type { GameEvent, PlayerView } from './types.ts'

export type DisplayView = PlayerView & { source_action_id?: string | null }

export type BeatEnvelope = {
  run_id: string
  action_id: string | null
  revision: number
  view: PlayerView
  visibility?: string
}

const INNER_MARK = /[（(]内心[:：][^）)]*[）)]/g

function stripInnerSpeech(text: string): string {
  return text.replace(INNER_MARK, '').replace(/\s+/g, ' ').trim()
}

export function sanitizePlayerView(view: PlayerView): PlayerView {
  const history = view.history
    ?.filter((item) => item.source !== 'thought' && item.source !== 'monologue' && item.source !== 'intent')
    .map((item) => ({
      turn: item.turn,
      source: item.source,
      text: stripInnerSpeech(item.text),
      action_id: item.action_id ?? null,
      label: item.label ?? '',
      cost_text: item.cost_text ?? '',
    }))
  return {
    run_id: view.run_id,
    revision: view.revision,
    turn: view.turn,
    turns_max: view.turns_max,
    location: view.location,
    location_label: view.location_label,
    player: view.player,
    objective: view.objective,
    meters: { ...view.meters },
    resources: { ...view.resources },
    promises: view.promises.map((item) => ({ ...item })),
    known: [...view.known],
    scene: {
      speaker: view.scene.speaker,
      body: stripInnerSpeech(view.scene.body),
    },
    last_consequence: stripInnerSpeech(view.last_consequence),
    legal_actions: view.legal_actions.map((item) => ({ ...item })),
    ending: view.ending ? { ...view.ending, causes: view.ending.causes.map((c) => ({ ...c })) } : null,
    history,
    visibility: 'player',
    performance: view.performance ?? null,
  }
}

export function isLateBeat(prev: DisplayView | null, envelope: BeatEnvelope): boolean {
  if (!prev) return false
  if (envelope.run_id !== prev.run_id) return true
  if (envelope.revision < prev.revision) return true
  if (
    envelope.revision === prev.revision &&
    envelope.action_id &&
    prev.source_action_id &&
    envelope.action_id !== prev.source_action_id
  ) {
    return true
  }
  return false
}

export function applyBeat(prev: DisplayView | null, envelope: BeatEnvelope): DisplayView {
  if (envelope.visibility && envelope.visibility !== 'player') {
    return prev ?? { ...sanitizePlayerView(envelope.view), source_action_id: envelope.action_id }
  }
  if (isLateBeat(prev, envelope)) return prev as DisplayView
  const clean = sanitizePlayerView(envelope.view)
  return { ...clean, source_action_id: envelope.action_id }
}

export function applyGameEvent(prev: DisplayView | null, event: GameEvent, view: PlayerView): DisplayView {
  return applyBeat(prev, {
    run_id: event.run_id,
    action_id: event.source_action_id ?? null,
    revision: event.revision,
    view,
    visibility: event.visibility,
  })
}

export function reduceView(prev: PlayerView | null, next: PlayerView): DisplayView {
  const prior = prev as DisplayView | null
  return applyBeat(prior, {
    run_id: next.run_id,
    action_id: (next as DisplayView).source_action_id ?? null,
    revision: next.revision,
    view: next,
    visibility: next.visibility,
  })
}
