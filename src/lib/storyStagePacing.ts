/** Stage card types that occupy the main story paper. */
export const STORY_STAGE_CARD_TYPES = new Set([
  'scene_change',
  'agent_speak',
  'agent_think',
  'agent_act',
])

/** Default dwell so each think / speak / scene is readable. */
export const STAGE_DWELL_MS = 7000

export type StageEventLike = { type: string }

/** Indices of events that should appear on the main stage paper. */
export function listStageCardIndices(
  events: readonly StageEventLike[],
  cardTypes: ReadonlySet<string> = STORY_STAGE_CARD_TYPES,
): number[] {
  const out: number[] = []
  for (let i = 0; i < events.length; i += 1) {
    if (cardTypes.has(events[i].type)) out.push(i)
  }
  return out
}

/**
 * How long to wait before advancing from the card currently on stage.
 * First card of a queue shows immediately (wait 0 when no prior show time).
 */
export function dwellRemainingMs(
  shownAtMs: number | null,
  nowMs: number,
  dwellMs: number = STAGE_DWELL_MS,
): number {
  if (shownAtMs == null) return 0
  const elapsed = Math.max(0, nowMs - shownAtMs)
  return Math.max(0, dwellMs - elapsed)
}

/**
 * Next position in the card-index list, or null if already at the tail.
 * `cardPos` is an index into `cardIndices`, not into the raw events array.
 */
export function nextCardPos(
  cardPos: number,
  cardCount: number,
): number | null {
  if (cardCount <= 0) return null
  if (cardPos < 0) return 0
  if (cardPos >= cardCount - 1) return null
  return cardPos + 1
}
