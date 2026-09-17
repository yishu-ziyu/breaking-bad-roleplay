/* Story feed reducer (P5② — full-stack review): pure dedup rules, decoupled
 * from the React hook so they are unit-testable in Node.
 *
 * The previous rule deduplicated agent_speak GLOBALLY by
 * character+content, which silently dropped legitimate dialogue — characters
 * do repeat lines (callbacks, insistence, echoes from other speakers), and a
 * repeated line anywhere later in the story simply vanished from the feed.
 *
 * The genuine artifact that dedup exists to absorb is a RECONNECT echo: the
 * server re-streaming the last delivered line right where the feed was
 * interrupted. That is adjacent, not global — so only the following are
 * dropped:
 *  - agent_speak identical to the LAST feed event (same character+content);
 *  - beat_ready for a beat_id that already produced a beat_ready.
 */

export type StoryEvent = {
  type: string
  data: Record<string, unknown>
  received_at?: number
}

/** Bound memory in long sessions: drop oldest events beyond the cap. */
export const MAX_FEED_EVENTS = 200

export function applyIncomingEvent(
  prev: StoryEvent[],
  evt: StoryEvent,
  now: number = Date.now(),
): StoryEvent[] {
  const eventId = evt.data?.event_id
  if (typeof eventId === 'string' && prev.some((e) => e.data?.event_id === eventId)) {
    return prev
  }
  if (!eventId && evt.type === 'agent_speak' && prev.length > 0) {
    const last = prev[prev.length - 1]
    if (
      last.type === 'agent_speak' &&
      last.data?.character_id === evt.data?.character_id &&
      last.data?.content === evt.data?.content
    ) {
      return prev // adjacent reconnect echo
    }
  }
  if (evt.type === 'beat_ready' && typeof evt.data?.beat_id === 'string') {
    const seen = prev.some(
      (e) => e.type === 'beat_ready' && e.data?.beat_id === evt.data?.beat_id,
    )
    if (seen) return prev
  }
  const next = [...prev, { ...evt, received_at: evt.received_at ?? now }]
  return next.length > MAX_FEED_EVENTS ? next.slice(next.length - MAX_FEED_EVENTS) : next
}

/** What the server said about a command whose player line is still local. */
export type CommandSettlement =
  /** Committed: promote the local claim to real story text in place. The
   * server outbox event carries the same ``event_id`` and is dropped as a
   * duplicate, so nothing else would ever clear the marker. */
  | 'committed'
  /** The server never received it: remove the line outright. A line that
   * never happened must not survive as an orphan in the manuscript. */
  | 'absent'
  /** The server holds it and is still working: keep the line, keep the
   * marker. Waiting is not the same as never having happened. */
  | 'pending'

export function settleCommandEvents(
  events: StoryEvent[],
  commandId: string,
  settlement: CommandSettlement,
): StoryEvent[] {
  if (settlement === 'pending') return events
  const isPending = (evt: StoryEvent) =>
    evt.data?.command_id === commandId && evt.data?.pending === true
  if (!events.some(isPending)) return events
  if (settlement === 'absent') return events.filter((evt) => !isPending(evt))
  return events.map((evt) =>
    isPending(evt) ? { ...evt, data: { ...evt.data, pending: false } } : evt,
  )
}
