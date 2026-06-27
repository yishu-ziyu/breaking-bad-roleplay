/* =================================================================
   ABQ Roleplay Lab — SSE heartbeat configuration
   ================================================================= */

/**
 * Maximum time between SSE heartbeats before the client considers the
 * connection stale. Kept >= 30s so complex story beats do not falsely
 * trigger reconnects.
 */
export const HEARTBEAT_TIMEOUT = 45_000

/**
 * Extra grace period added to the heartbeat timeout before a reconnect.
 */
export const HEARTBEAT_TOLERANCE = 5_000
