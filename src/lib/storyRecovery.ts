/* P0 network-recovery decisions for the live Story stream.

Kept pure and outside the React hook so the retry policy and the question
"what does the server actually hold?" stay unit-testable in Node (no DOM, no
renderer). The hook owns the timers, the fetches and the React state.
*/

import type { StoryConnectionState } from '../hooks/useStoryStream'

/** Wait before the next recovery attempt for the same command. */
export const TURN_RETRY_BASE_MS = 800
export const TURN_RETRY_CAP_MS = 5_000
/** Total attempts per interrupted command (~20s), never an endless loop. */
export const TURN_RETRY_LIMIT = 6

/** Backoff for attempt N (0-based), or null when the budget is spent. */
export function turnRetryDelay(attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 0 || attempt >= TURN_RETRY_LIMIT) return null
  return Math.min(TURN_RETRY_BASE_MS * 2 ** attempt, TURN_RETRY_CAP_MS)
}

/** Stop must be confirmed, not assumed: bounded re-asks before the client
 * keeps the session and tells the player it is unconfirmed. */
export const STOP_RETRY_LIMIT = 3

export function stopRetryDelay(attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 0 || attempt >= STOP_RETRY_LIMIT) return null
  return Math.min(500 * 2 ** attempt, 2_000)
}

export type CommandReality =
  /** The server is still generating this exact command (old stream alive). */
  | 'pending'
  /** This exact command is the latest committed beat: replay it for free. */
  | 'committed'
  /** The server does not hold this command at all. */
  | 'absent'
  | 'paused'
  | 'complete'
  | 'stopped'
  | 'missing'
  /** The probe itself failed (offline). Keep waiting, do not guess. */
  | 'unknown'
  /** The run was reset or stopped while the probe was in flight: do nothing,
   * never reopen a stream for a session this client has left. */
  | 'stale'

/** Reality of one command according to GET /state. Never returns 'stale';
 * that value is produced by the caller's lifecycle epoch check. */
export function classifyCommandReality(
  snapshot: Record<string, unknown> | null,
  commandId: string,
): CommandReality {
  if (!snapshot) return 'unknown'
  const status = typeof snapshot.status === 'string' ? snapshot.status : ''
  const pending = typeof snapshot.pending_command_id === 'string' ? snapshot.pending_command_id : ''
  const last = typeof snapshot.command_id === 'string' ? snapshot.command_id : ''
  if (pending && pending === commandId) return 'pending'
  if (last && last === commandId) return 'committed'
  if (status === 'stopped') return 'stopped'
  if (status === 'complete') return 'complete'
  if (status === 'paused') return 'paused'
  return 'absent'
}

/** A response that ended without beat_ready / complete / error.
 *
 * 'connecting' is the manual-reconnect and first-connect window: the server
 * may still be claiming the turn, so it gets the same single silent retry as
 * 'streaming' instead of an instant error card. */
export function transportEndVerdict(
  state: StoryConnectionState,
  alreadyRetried: boolean,
): 'ignore' | 'retry' | 'fail' {
  if (state === 'beat_paused' || state === 'complete' || state === 'idle') return 'ignore'
  return alreadyRetried ? 'fail' : 'retry'
}
