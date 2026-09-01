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
  if (evt.type === 'agent_speak' && prev.length > 0) {
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
