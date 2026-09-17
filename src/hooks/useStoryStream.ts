/* =================================================================
   ABQ Roleplay Lab — useStoryStream (SSE real-time streaming)
   Connects to backend /api/session/{id}/stream via EventSource.
   Player decisions at beat_ready affect real plot progression.
   ================================================================= */

import { useCallback, useEffect, useRef, useState } from 'react'
import { authHeaders } from '../lib/authHeaders'
import { getOrCreateGuestId } from '../lib/guestId'
import { openFetchSse, type SseController } from '../lib/sseFetch'
import {
  applyIncomingEvent,
  settleCommandEvents,
  type CommandSettlement,
  type StoryEvent,
} from '../lib/storyFeed'
import { trimFeedForBeatRedraw, trimFeedThroughBeat } from '../lib/storyReading'
import { buildStoryCommand } from '../lib/storyCommands'
import {
  STOP_RETRY_LIMIT,
  classifyCommandReality,
  stopRetryDelay,
  transportEndVerdict,
  turnRetryDelay,
  type CommandReality,
} from '../lib/storyRecovery'

export type { StoryEvent }

export type StoryConnectionState =
  | 'idle' | 'connecting' | 'streaming'
  | 'beat_paused' | 'complete' | 'error'

export type StoryAction =
  | 'act'
  | 'continue'
  | 'stop'
  | 'redirect'
  | 'switch_perspective'
  | 'continue_chapter'
  | 'branch'
  | 'replay'

export interface StoryActionParams {
  player_input?: string
  player_kind?: 'say' | 'do' | 'observe' | 'free'
  redirect_prompt?: string
  target_character?: string
  from_beat_id?: string
  branch_goal?: string
  beat_id?: string
}

/* ----- Backend message schema (GET /api/session/{id}/messages) ----- */
interface MessageOut {
  id: string
  session_id: string
  role: string
  content: string
  character_name: string | null
  emotion_state: string | null
  gif_search_query: string | null
  beat_id: string | null
  created_at: string
}

/* ----- localStorage key for session persistence (abq_ prefix) ----- */
const SESSION_STORAGE_KEY = 'abq_story_session_id'
const SESSION_KEY_STORAGE = 'abq_story_session_key'

/* ----- Event feed cap: long streaming sessions can produce hundreds of
 * events; MAX_FEED_EVENTS in lib/storyFeed.ts bounds memory growth. */

function readSavedSessionId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeSavedSessionId(sid: string, sessionKey?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, sid)
    if (sessionKey) window.localStorage.setItem(SESSION_KEY_STORAGE, sessionKey)
  } catch {
    /* ignore storage errors */
  }
}

function readSavedSessionKey(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(SESSION_KEY_STORAGE)
  } catch {
    return null
  }
}

function clearSavedSessionId(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    window.localStorage.removeItem(SESSION_KEY_STORAGE)
  } catch {
    /* ignore storage errors */
  }
}

export function sessionAuthHeaders(sessionKey?: string | null): Record<string, string> {
  const key = sessionKey ?? readSavedSessionKey()
  return key ? { 'X-Session-Key': key } : {}
}

/* ----- Existence probe for an existing session -----
 * Used by the mount-time auto-resume flow to decide whether to call
 * resumeSession (which would set connectionState='connecting' and flash
 * a typing indicator) or skip straight to a toast. Returns "alive" when
 * the session exists, "missing" only on confirmed 404, and "error" for
 * transient or unknown probe failures.
 * Exported for unit testing. */
export type SessionProbeResult = 'alive' | 'missing' | 'error'

export async function pingSession(sid: string): Promise<SessionProbeResult> {
  if (!sid) return 'missing'
  try {
    const res = await fetch(`/api/session/${sid}/messages?limit=1`, {
      method: 'GET',
      headers: { ...sessionAuthHeaders() },
    })
    if (res.ok) return 'alive'
    if (res.status === 404 || res.status === 403) return 'missing'
    return 'error'
  } catch {
    return 'error'
  }
}

/* ----- Auto-resume toast text (English copy; not localized.
 * This only fires when an existing saved session is gone). */
const RESUME_EXPIRED_TOAST = 'Your last session expired (deleted or server reset). Start a new one.'
const RESUME_RETRY_TOAST = 'Could not verify your last session. Try again when the server is reachable.'
/* P0 network recovery. These are notices inside the running scene, not error
 * pages: the run is intact and the client is still working the problem. */
const NOTICE_COPY = {
  confirming: {
    zh: '上一步还在结算，正在自动接着演出——不用重复发送。',
    en: 'Your last move is still resolving. Reconnecting to it now — nothing to resend.',
  },
  refused: {
    zh: '上一步还没确认落地。等它出结果，再送新的行动。',
    en: 'Your last move is not confirmed yet. Let it land before sending a different one.',
  },
  unconfirmed: {
    zh: '上一步没有送达导演。再发一次会用同一个编号，不会重复扣额度。',
    en: 'Your last move never reached the director. Sending it again keeps the same id and is never charged twice.',
  },
  stalled: {
    zh: '导演还在收尾。进度已保存——稍后重试。',
    en: 'The director is still finishing. Your progress is saved — retry in a moment.',
  },
  stopFailed: {
    zh: '停止尚未确认：服务器没有回应。本地已停下，但这场 run 可能还在生成——再点一次停止，或稍后重试。',
    en: 'Stop is not confirmed yet: the server did not answer. It is paused here, but the run may still be generating — press Stop again.',
  },
} as const

export type CommandNoticeKind = keyof typeof NOTICE_COPY

function noticeText(kind: CommandNoticeKind, language?: string): string {
  const lang = (language ?? readPersistedStoryLanguage()) === 'zh' ? 'zh' : 'en'
  return NOTICE_COPY[kind][lang]
}

/* Event dedup moved to src/lib/storyFeed.ts (P5②): the old GLOBAL
 * character+content dedup swallowed legitimate repeated lines. */

export function beatIndexFromBeatId(beatId: unknown): number | null {
  if (typeof beatId !== 'string') return null
  const match = beatId.match(/^beat[_-](\d+)$/i)
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function deriveBeatProgressFromMessages(messages: Array<{ beat_id: string | null }>): {
  beatId: string | null
  beatIndex: number
} {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const beatId = messages[i]?.beat_id ?? null
    const beatIndex = beatIndexFromBeatId(beatId)
    if (beatIndex !== null) return { beatId, beatIndex }
  }
  return { beatId: null, beatIndex: 0 }
}

export function shouldApplyStoryIdentity(
  currentRevision: number,
  eventRevision: unknown,
): boolean {
  return typeof eventRevision !== 'number' || eventRevision >= currentRevision
}

/**
 * Build SSE query string for /api/session/{id}/stream.
 * Always includes language so continue/reconnect never fall back to the
 * backend default (en) after the first beat_paused close.
 */
export function buildStreamQuery(opts: {
  voiceExample?: string | null
  language?: string | null
}): string {
  const parts: string[] = []
  if (opts.voiceExample) {
    parts.push(`voice_example=${encodeURIComponent(opts.voiceExample)}`)
  }
  const language = (opts.language && opts.language.trim()) || 'en'
  parts.push(`language=${encodeURIComponent(language)}`)
  // A/B blind-test switch: propagate ?zh_guard=0 from the page URL so the
  // backend can skip the Chinese-expression guard for this Story session.
  if (typeof window !== 'undefined' && window.location) {
    const pageZhGuard = new URLSearchParams(window.location.search).get('zh_guard')
    if (pageZhGuard != null) {
      parts.push(`zh_guard=${encodeURIComponent(pageZhGuard)}`)
    }
  }
  return `?${parts.join('&')}`
}

/** Headers for fetch SSE — secrets never go on the query string. */
export function buildStreamHeaders(opts: {
  connectionSessionId?: string | null
  sessionKey?: string | null
  extra?: Record<string, string>
}): Record<string, string> {
  const headers: Record<string, string> = {
    ...opts.extra,
    'X-Guest-Id': getOrCreateGuestId(),
    ...sessionAuthHeaders(opts.sessionKey),
  }
  if (opts.connectionSessionId) {
    headers['X-Connection-Session'] = opts.connectionSessionId
  }
  return headers
}

/** Read UI language from abq_language (usePersistedState key). */
export function readPersistedStoryLanguage(): string {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage
    if (!storage?.getItem) return 'en'
    const raw = storage.getItem('abq_language')
    if (raw == null) return 'en'
    const parsed = JSON.parse(raw) as unknown
    if (parsed === 'zh' || parsed === 'en') return parsed
    return 'en'
  } catch {
    return 'en'
  }
}

export interface UseStoryStreamReturn {
  events: StoryEvent[]
  outline: string | null
  sessionId: string | null
  playerActorId: string | null
  connectionState: StoryConnectionState
  currentBeatId: string | null
  beatIndex: number
  isSendingByChar: Record<string, boolean>
  errorByChar: Record<string, string | null>
  autoContinued: boolean
  isResuming: boolean
  resumeToast: string | null
  /** Classified failure for the interrupted-state UI (QA P0#1/#2).
   * 'binding' = P3: the saved BYOK key link expired (server restart) and
   * the one automatic rebind from the local vault did not recover it. */
  streamFailure: { kind: 'timeout' | 'network' | 'http' | 'binding' | 'quota' | 'unknown'; message: string } | null
  /** Notice about a command the client has not confirmed with the server
   * (still generating, refused because it is unconfirmed, or never arrived).
   * Null when every command the player made is accounted for. */
  commandNotice: { kind: CommandNoticeKind; message: string } | null
  startStory: (
    taskPrompt: string,
    characterId?: string,
    voiceExample?: string | null,
    language?: string,
    connectionSessionId?: string | null,
    scenarioId?: 'conversation' | 'desert_crisis',
  ) => Promise<void>
  setConnectionSessionId: (id: string | null) => void
  /** P3: wire the BYOK rebind path (App -> useConnection.ensureBound).
   * Returns a fresh connection session id or null when no vault key can
   * re-bind. Called at most once per story attempt on HTTP 410. */
  setBindingRecover: (fn: (() => Promise<string | null>) | null) => void
  sendAction: (action: StoryAction, params?: StoryActionParams, characterId?: string) => Promise<boolean>
  appendLocalEvent: (evt: StoryEvent) => void
  redrawBeat: (beatId: string, characterId?: string) => Promise<void>
  reconnect: () => void
  reset: () => void
  resumeSession: (sid: string) => Promise<void>
  dismissResumeToast: () => void
  getCharState: (characterId: string) => { isSending: boolean; error: string | null }
}

export function useStoryStream({ autoResume = true }: { autoResume?: boolean } = {}): UseStoryStreamReturn {
  const [events, setEvents] = useState<StoryEvent[]>([])
  const [outline, setOutline] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [playerActorId, setPlayerActorId] = useState<string | null>(null)
  // P0-3: do NOT pre-set 'connecting' just because localStorage has a
  // savedSid. The auto-resume effect will probe session history first; only if
  // the backend confirms the session exists will it transition to
  // 'connecting'. This eliminates the 1–3s "Connecting…" flash when the
  const [connectionState, setConnectionState] = useState<StoryConnectionState>('idle')
  const connectionStateRef = useRef<StoryConnectionState>('idle')
  const updateConnectionState = useCallback((nextState: StoryConnectionState) => {
    connectionStateRef.current = nextState
    setConnectionState(nextState)
  }, [])
  const [currentBeatId, setCurrentBeatId] = useState<string | null>(null)
  const [beatIndex, setBeatIndex] = useState(0)
  const [isSendingByChar, setIsSendingByChar] = useState<Record<string, boolean>>({})
  const [errorByChar, setErrorByChar] = useState<Record<string, string | null>>({})
  const [autoContinued, setAutoContinued] = useState(false)
  // Same fix as connectionState: don't claim we're "resuming" until the
  // session-history probe confirms the session is still alive.
  const [isResuming, setIsResuming] = useState<boolean>(false)
  const [resumeToast, setResumeToast] = useState<string | null>(null)
  /* QA P0#1/#2: classified failure while streaming. The old flow could sit in
   * 'streaming' forever when the SSE closed without a terminal event. */
  const [streamFailure, setStreamFailure] = useState<UseStoryStreamReturn['streamFailure']>(null)
  /* Plain-language notice for an unresolved / refused command. Rendered in
   * the decision bar, never as an error page: the run itself is fine. */
  const [commandNotice, setCommandNotice] = useState<UseStoryStreamReturn['commandNotice']>(null)

  const esRef = useRef<SseController | null>(null)
  const sessionRef = useRef<string | null>(null)
  const hasAttemptedResumeRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  /* Streaming watchdog: if no bytes at all (event OR heartbeat ping)
   * arrive within STREAM_STALL_TIMEOUT_MS while we claim to be
   * 'streaming', surface an interrupted state instead of an eternal
   * spinner. The backend emits `: ping` every 15s of Director silence, so
   * this only fires when the connection is genuinely dead. */
  const stallTimerRef = useRef<number | null>(null)
  /* One silent reconnect per stall — a transient proxy drop should not need
   * player attention. */
  const stallReconnectRef = useRef(false)
  /* P3: the server answers 410 binding_expired when a BYOK bind id outlives
   * the process that created it (restart / TTL). Recovery = re-bind from the
   * client-side vault exactly once, silently. */
  const bindingRecoverRef = useRef<(() => Promise<string | null>) | null>(null)
  const bindingRecoverTriedRef = useRef(false)
  // Persist across beat_paused → continue (stream is closed after each beat).
  const languageRef = useRef<string>(readPersistedStoryLanguage())
  const voiceExampleRef = useRef<string | null>(null)
  const connectionSessionRef = useRef<string | null>(null)
  const runtimeVersionRef = useRef(0)
  const worldRevisionRef = useRef(0)
  const commandRef = useRef<string | null>(null)
  /* ``ack`` is the server's answer about this command, not our hope. Until
   * /state says otherwise it stays 'unconfirmed', and an unconfirmed command
   * must not be silently replaced by a different one (the player would lose
   * the move they already made). */
  const pendingCommandRef = useRef<{
    signature: string
    body: Record<string, unknown>
    ack: 'unconfirmed' | 'pending' | 'committed' | 'absent' | 'rejected'
  } | null>(null)
  const connectStreamRef = useRef<(
    sid: string,
    voiceExample?: string | null,
    language?: string,
  ) => void>(() => undefined)
  /* Bounded recovery timer for one interrupted command. Never a loop: the
   * attempt budget lives in storyRecovery.turnRetryDelay. The budget belongs
   * to ONE command, and the epoch invalidates any probe that was already in
   * flight when the session was reset or stopped. */
  const turnRetryTimerRef = useRef<number | null>(null)
  const turnRetryAttemptsRef = useRef(0)
  const turnRetryCommandRef = useRef<string | null>(null)
  const autoResendCommandRef = useRef<string | null>(null)
  const recoveryEpochRef = useRef(0)
  /* Which command currently owns recovery. Recovery mutates shared refs
   * (commandRef, notices, connection state), so a response that arrives for a
   * command the client has already moved past must change nothing. */
  const activeRecoveryCommandRef = useRef<string | null>(null)
  /* The in-flight recovery request set. Stop / reset / unmount / a newer
   * command aborts it so a slow /state or resend cannot outlive the decision. */
  const abortRecoveryRef = useRef<AbortController | null>(null)

  const STREAM_STALL_TIMEOUT_MS = 90_000
  /* An /action POST that never answers is indistinguishable from a lost
   * acknowledgement — after this long the client stops waiting and recovers. */
  const ACTION_DEADLINE_MS = 20_000
  /* Same idea for the /state probe: a half-open GET must not strand the UI. */
  const PROBE_DEADLINE_MS = 10_000

  useEffect(() => {
    connectionStateRef.current = connectionState
  }, [connectionState])

  const closeEventSource = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    if (stallTimerRef.current != null) {
      window.clearTimeout(stallTimerRef.current)
      stallTimerRef.current = null
    }
  }, [])

  /** Rearm the stall watchdog — called on every SSE event and on connect. */
  const armStallWatchdog = useCallback((sid: string) => {
    if (stallTimerRef.current != null) {
      window.clearTimeout(stallTimerRef.current)
    }
    stallTimerRef.current = window.setTimeout(() => {
      stallTimerRef.current = null
      // Only fire while we still claim to be streaming (a beat_ready/complete
      // may have arrived and closed the stream legitimately).
      esRef.current?.close()
      esRef.current = null
      const current = connectionStateRef.current
      if (current !== 'streaming' && current !== 'connecting') return
      // First stall: close the dead controller, then reconnect once. Keeping
      // the side effect outside a React state updater avoids duplicate work
      // under Strict Mode.
      if (!stallReconnectRef.current) {
        stallReconnectRef.current = true
        closeEventSource()
        connectStreamRef.current(sid, undefined, undefined)
        return
      }
      setStreamFailure({
        kind: 'timeout',
        message:
          'Lost contact with the director (no response on any channel for 90s). Your progress is saved — retry or continue later.',
      })
      updateConnectionState('error')
    }, STREAM_STALL_TIMEOUT_MS)
  }, [STREAM_STALL_TIMEOUT_MS, closeEventSource, updateConnectionState])

  const setSessionError = useCallback((err: string | null) => {
    setErrorByChar(prev => ({ ...prev, '__session__': err }))
  }, [])

  /** Cancel any scheduled recovery and reset its budget.
   * Called on every terminal state (beat_ready / complete / error / reset /
   * stop) and on any live event, so a stale timer can never fire into a new
   * beat or resurrect an abandoned command. */
  const abortActiveRecovery = useCallback(() => {
    abortRecoveryRef.current?.abort()
    abortRecoveryRef.current = null
  }, [])

  const clearTurnRetry = useCallback(() => {
    if (turnRetryTimerRef.current != null) {
      window.clearTimeout(turnRetryTimerRef.current)
      turnRetryTimerRef.current = null
    }
    turnRetryAttemptsRef.current = 0
    turnRetryCommandRef.current = null
    autoResendCommandRef.current = null
  }, [])

  const setNotice = useCallback((kind: CommandNoticeKind | null) => {
    setCommandNotice(kind ? { kind, message: noticeText(kind, languageRef.current) } : null)
  }, [])

  const clearStorySessionState = useCallback((options?: {
    clearStorage?: boolean
    clearCharacterFeedback?: boolean
  }) => {
    closeEventSource()
    setEvents([])
    setOutline(null)
    setSessionId(null)
    setPlayerActorId(null)
    setCurrentBeatId(null)
    setBeatIndex(0)
    setAutoContinued(false)
    setStreamFailure(null)
    stallReconnectRef.current = false
    bindingRecoverTriedRef.current = false
    // Invalidate any recovery that is already awaiting /state: it must not
    // reopen a stream for a session this client has just abandoned.
    recoveryEpochRef.current += 1
    activeRecoveryCommandRef.current = null
    abortActiveRecovery()
    clearTurnRetry()
    setCommandNotice(null)
    updateConnectionState('idle')
    sessionRef.current = null
    runtimeVersionRef.current = 0
    worldRevisionRef.current = 0
    commandRef.current = null
    pendingCommandRef.current = null
    // Keep language/voice for the next continue within the same UI session;
    // only drop voice on full reset (storage clear).
    if (options?.clearStorage) {
      voiceExampleRef.current = null
      languageRef.current = readPersistedStoryLanguage()
    }
    if (options?.clearCharacterFeedback) {
      setIsSendingByChar({})
      setErrorByChar({})
    }
    if (options?.clearStorage) {
      clearSavedSessionId()
    }
  }, [abortActiveRecovery, clearTurnRetry, closeEventSource, updateConnectionState])

  const appendEvent = useCallback((evt: StoryEvent) => {
    setEvents((prev) => {
      const merged = applyIncomingEvent(prev, evt)
      const commandId = typeof evt.data?.command_id === 'string' ? evt.data.command_id : null
      // Anything arriving over SSE already committed server-side, so a local
      // claim for that command is now real story text. (The server copy uses
      // the identical event_id and is dropped as a duplicate, so this is the
      // only place that can clear the marker.)
      if (!commandId || evt.data?.pending === true) return merged
      return settleCommandEvents(merged, commandId, 'committed')
    })
  }, [])

  const setConnectionSessionId = useCallback((id: string | null) => {
    connectionSessionRef.current = id
  }, [])

  // P3: App wires this to useConnection.ensureBound({force:true}) so a
  // 410 binding_expired can self-heal once from the local vault.
  const setBindingRecover = useCallback(
    (fn: (() => Promise<string | null>) | null) => {
      bindingRecoverRef.current = fn
    },
    [],
  )

  const probeStorySnapshot = useCallback(async (
    sid: string,
    signal?: AbortSignal,
  ): Promise<{
    missing: boolean
    snapshot: Record<string, unknown> | null
  }> => {
    // A /state that never answers must not pin the UI: the probe has its own
    // deadline, and the caller's abort (Stop / reset / newer command) also
    // cancels it. Either way the answer becomes 'unknown' and the caller's
    // bounded loop decides what to do.
    const controller = new AbortController()
    const deadline = window.setTimeout(() => controller.abort(), PROBE_DEADLINE_MS)
    const onOuterAbort = () => controller.abort()
    signal?.addEventListener('abort', onOuterAbort, { once: true })
    try {
      const res = await fetch(`/api/session/${sid}/state`, {
        headers: { ...sessionAuthHeaders() },
        signal: controller.signal,
      })
      if (res.status === 404) return { missing: true, snapshot: null }
      if (!res.ok) return { missing: false, snapshot: null }
      return { missing: false, snapshot: (await res.json()) as Record<string, unknown> }
    } catch {
      return { missing: false, snapshot: null }
    } finally {
      window.clearTimeout(deadline)
      signal?.removeEventListener('abort', onOuterAbort)
    }
  }, [])

  /** Adopt the server's committed truth: merge the outbox (deduplicated by
   * event_id) and settle the optimistic player line for ``commandId``. */
  const applyCommittedSnapshot = useCallback((
    snapshot: Record<string, unknown>,
    commandId: string,
    settlement: CommandSettlement,
  ) => {
    const revision = snapshot.world_revision
    const applyIdentity = shouldApplyStoryIdentity(worldRevisionRef.current, revision)
    if (typeof revision === 'number') {
      worldRevisionRef.current = Math.max(worldRevisionRef.current, revision)
    }
    if (snapshot.runtime_version === 1) runtimeVersionRef.current = 1
    if (applyIdentity && typeof snapshot.player_actor_id === 'string') {
      setPlayerActorId(snapshot.player_actor_id)
    }
    const restored = Array.isArray(snapshot.events) ? (snapshot.events as StoryEvent[]) : []
    // The outbox is the authority: if it holds events for this command, the
    // command really committed (the duplicate copy is dropped by event_id, so
    // the optimistic line has to be promoted in place). Otherwise the caller's
    // hint decides, and an unconfirmed line is never presented as history.
    const hasCommittedEvents = restored.some(
      (evt) => evt.data?.command_id === commandId,
    )
    const resolved: CommandSettlement = hasCommittedEvents ? 'committed' : settlement
    setEvents((prev) => {
      let next = prev
      for (const evt of restored) next = applyIncomingEvent(next, evt)
      return settleCommandEvents(next, commandId, resolved)
    })
  }, [])

  /** Ask the server to stop, then verify. Never assume: an unanswered stop
   * leaves a run generating and billing, so the client re-asks a bounded
   * number of times and cross-checks /state before it drops the session. */
  const requestStop = useCallback(async (
    sid: string,
    signal?: AbortSignal,
  ): Promise<'stopped' | 'gone' | 'unconfirmed' | 'aborted'> => {
    for (let attempt = 0; attempt < STOP_RETRY_LIMIT; attempt += 1) {
      try {
        const res = await fetch(`/api/session/${sid}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
          body: JSON.stringify({ action: 'stop' }),
          signal,
        })
        if (res.ok) return 'stopped'
        if (res.status === 404) return 'gone'
        // story_paused / story_stopped: the server agrees nothing is running.
        if (res.status === 409) return 'stopped'
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return 'aborted'
      }
      if (signal?.aborted) return 'aborted'
      // Network failure or 5xx: ask /state what the session really is before
      // deciding the stop is unconfirmed. The probe is abortable too, so a
      // hung /state can never trap the Stop loop.
      const { missing, snapshot } = await probeStorySnapshot(sid, signal)
      if (signal?.aborted) return 'aborted'
      if (missing) return 'gone'
      if (snapshot && snapshot.status === 'stopped') return 'stopped'
      const delay = stopRetryDelay(attempt)
      if (delay == null) break
      await new Promise((resolve) => { window.setTimeout(resolve, delay) })
    }
    return 'unconfirmed'
  }, [probeStorySnapshot])

  /** Re-send the SAME command (same command_id, same body) after the server
   * confirmed it never arrived. Bound to one automatic attempt per command. */
  const resendPendingCommand = useCallback(async (
    sid: string,
    commandId: string,
    pending: { signature: string; body: Record<string, unknown>; ack: string },
    signal?: AbortSignal,
  ): Promise<'accepted' | 'failed' | 'stale'> => {
    const epoch = recoveryEpochRef.current
    const stale = () => epoch !== recoveryEpochRef.current
      || activeRecoveryCommandRef.current !== commandId
      || signal?.aborted === true
    const controller = new AbortController()
    const deadline = window.setTimeout(() => controller.abort(), ACTION_DEADLINE_MS)
    const onOuterAbort = () => controller.abort()
    signal?.addEventListener('abort', onOuterAbort, { once: true })
    try {
      const res = await fetch(`/api/session/${sid}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify(pending.body),
        signal: controller.signal,
      })
      // A Stop (or a newer command) may have happened while this was in the
      // air: touch nothing, open nothing.
      if (stale()) return 'stale'
      if (!res.ok) {
        setNotice('unconfirmed')
        return 'failed'
      }
      const accepted = await res.json() as Record<string, unknown>
      if (stale()) return 'stale'
      if (accepted.runtime_version === 1) {
        runtimeVersionRef.current = 1
        if (typeof accepted.world_revision === 'number') {
          worldRevisionRef.current = accepted.world_revision
        }
        if (typeof accepted.command_id === 'string') commandRef.current = accepted.command_id
      }
      if (pendingCommandRef.current === pending) pendingCommandRef.current.ack = 'pending'
      setNotice(null)
      if (!esRef.current) {
        connectStreamRef.current(sid, undefined, undefined)
      }
      return 'accepted'
    } catch {
      return stale() ? 'stale' : 'failed'
    } finally {
      window.clearTimeout(deadline)
      signal?.removeEventListener('abort', onOuterAbort)
    }
  }, [setNotice])

  /** Ask the server what it really holds for ``commandId`` and move the UI to
   * that truth. The only two side effects allowed here are: connect to the
   * SAME command, or (when the server confirms it never got it) re-send that
   * same command once. Never a new command, never a new POST body. */
  const recoverTurn = useCallback(async (
    sid: string,
    commandId: string,
    options?: { resend?: boolean; snapshot?: Record<string, unknown> },
  ): Promise<CommandReality> => {
    const epoch = recoveryEpochRef.current
    // This call owns recovery from here on: any older probe that comes back
    // later is stale and must not touch refs, notices or the stream.
    abortActiveRecovery()
    const controller = new AbortController()
    abortRecoveryRef.current = controller
    activeRecoveryCommandRef.current = commandId
    const { missing, snapshot } = options?.snapshot
      ? { missing: false, snapshot: options.snapshot }
      : await probeStorySnapshot(sid, controller.signal)
    // Reset/stop happened while we were probing, or a newer command took over:
    // the answer is about a run/command this client already left. Do nothing.
    if (epoch !== recoveryEpochRef.current) return 'stale'
    if (activeRecoveryCommandRef.current !== commandId) return 'stale'
    if (controller.signal.aborted) return 'stale'
    if (missing) {
      clearTurnRetry()
      setNotice(null)
      clearStorySessionState({ clearStorage: true })
      setResumeToast(RESUME_EXPIRED_TOAST)
      return 'missing'
    }
    const reality = classifyCommandReality(snapshot, commandId)
    if (reality === 'unknown') return reality
    if (reality === 'stopped') {
      // The run was stopped (this tab or another one). There is nothing to
      // recover: the client abandons the local session, same as pressing Stop.
      clearTurnRetry()
      setNotice(null)
      clearStorySessionState({ clearStorage: true })
      setResumeToast(RESUME_EXPIRED_TOAST)
      return reality
    }
    if (reality === 'complete' || reality === 'paused') {
      clearTurnRetry()
      // Reaching here means this command is NOT the last committed one, so do
      // not claim it committed — only the restored outbox may say so.
      if (snapshot) applyCommittedSnapshot(snapshot, commandId, 'absent')
      updateConnectionState(reality === 'complete' ? 'complete' : 'beat_paused')
      setNotice(null)
      return reality
    }
    const settlement: CommandSettlement = reality === 'committed'
      ? 'committed'
      : reality === 'pending' ? 'pending' : 'absent'
    if (snapshot) applyCommittedSnapshot(snapshot, commandId, settlement)
    const snapshotPending = typeof snapshot?.pending_command_id === 'string' ? snapshot.pending_command_id : ''
    commandRef.current = snapshotPending || commandId
    if (reality === 'committed') {
      if (pendingCommandRef.current) pendingCommandRef.current.ack = 'committed'
      setNotice(null)
      // Committed while we were away: replay the saved result. The server
      // serves a committed command from the outbox and does not bill it.
      connectStreamRef.current(sid, undefined, undefined)
      return reality
    }
    if (reality === 'pending') {
      if (pendingCommandRef.current) pendingCommandRef.current.ack = 'pending'
      setNotice('confirming')
      connectStreamRef.current(sid, undefined, undefined)
      return reality
    }
    // 'absent': the server never received this command.
    const pending = pendingCommandRef.current
    // Only ever resend the command we are actually recovering.
    const mine = pending && pending.body.command_id === commandId ? pending : null
    if (mine) mine.ack = 'absent'
    if (options?.resend === false || !mine) {
      // Either a different move owns the decision, or we have nothing local to
      // resend (the player never typed it here).
      if (!mine && pendingCommandRef.current) setNotice('unconfirmed')
      return reality
    }
    if (autoResendCommandRef.current !== commandId) {
      autoResendCommandRef.current = commandId
      const outcome = await resendPendingCommand(sid, commandId, mine, controller.signal)
      if (outcome === 'stale') return 'stale'
      if (outcome === 'failed') {
        // The resend itself may have landed without an answer. Keep asking
        // /state inside the bounded budget instead of stranding the move.
        scheduleRetryRef.current(sid, commandId)
      }
      return reality
    }
    setNotice('unconfirmed')
    return reality
  }, [abortActiveRecovery, applyCommittedSnapshot, clearStorySessionState, clearTurnRetry,
      probeStorySnapshot, resendPendingCommand, setNotice, updateConnectionState])

  const scheduleRetryRef = useRef<(sid: string, commandId: string) => void>(() => undefined)

  /** Follow the command the server actually holds.
   *
   * Used when our own command was rejected because another one is already in
   * flight (409 turn_in_progress) or when the client has no local command id.
   * Without this the UI would sit in 'streaming' with nothing streaming. */
  const adoptServerCommand = useCallback(async (sid: string): Promise<boolean> => {
    const epoch = recoveryEpochRef.current
    const { missing, snapshot } = await probeStorySnapshot(sid)
    if (epoch !== recoveryEpochRef.current) return false
    if (missing || !snapshot) {
      // The session is gone, or /state did not answer inside its deadline:
      // never leave the player on a spinner with nothing streaming.
      setNotice('unconfirmed')
      updateConnectionState('beat_paused')
      return true
    }
    const pending = typeof snapshot.pending_command_id === 'string' ? snapshot.pending_command_id : ''
    const last = typeof snapshot.command_id === 'string' ? snapshot.command_id : ''
    const target = pending || last
    if (!target) return false
    commandRef.current = target
    updateConnectionState('connecting')
    // Reuse the snapshot we already have: a second probe could fail and leave
    // the UI in a connectionless 'connecting'.
    const reality = await recoverTurn(sid, target, { snapshot })
    if (reality === 'stale' || reality === 'missing') return false
    if (reality === 'absent') {
      // Nothing on the server can be streamed for this session.
      setNotice('refused')
      updateConnectionState('beat_paused')
      return true
    }
    return true
  }, [probeStorySnapshot, recoverTurn, setNotice, updateConnectionState])


  /** Immediate probe after an uncertain send; if the probe itself fails,
   * fall back to the bounded retry loop so the UI never hangs in 'streaming'. */
  const recoverWithFallback = useCallback(async (
    sid: string,
    commandId: string,
  ): Promise<CommandReality> => {
    const reality = await recoverTurn(sid, commandId)
    if (reality === 'unknown') scheduleRetryRef.current(sid, commandId)
    return reality
  }, [recoverTurn])

  /** Wait, then re-ask. Bounded by turnRetryDelay: when the budget is spent
   * the player gets an actionable error instead of an endless reconnect. */
  const scheduleTurnRecovery = useCallback((sid: string, commandId: string) => {
    // A new command starts with a fresh budget; the old one's leftovers must
    // not make it give up early (or keep it alive forever).
    if (turnRetryCommandRef.current !== commandId) {
      turnRetryCommandRef.current = commandId
      turnRetryAttemptsRef.current = 0
    }
    const delay = turnRetryDelay(turnRetryAttemptsRef.current)
    if (delay == null) {
      clearTurnRetry()
      setNotice('stalled')
      setStreamFailure({
        kind: 'network',
        message: noticeText('stalled', languageRef.current),
      })
      updateConnectionState('error')
      return
    }
    turnRetryAttemptsRef.current += 1
    if (turnRetryTimerRef.current != null) {
      window.clearTimeout(turnRetryTimerRef.current)
    }
    const epoch = recoveryEpochRef.current
    turnRetryTimerRef.current = window.setTimeout(() => {
      turnRetryTimerRef.current = null
      if (epoch !== recoveryEpochRef.current) return
      if (activeRecoveryCommandRef.current !== commandId) return
      void (async () => {
        const reality = await recoverTurn(sid, commandId)
        // The probe itself failed (offline). Keep waiting inside the budget.
        if (reality === 'unknown') scheduleRetryRef.current(sid, commandId)
      })()
    }, delay)
  }, [clearTurnRetry, recoverTurn, setNotice, updateConnectionState])

  useEffect(() => {
    scheduleRetryRef.current = scheduleTurnRecovery
  }, [scheduleTurnRecovery])

  const connectStream = useCallback((sid: string, voiceExample?: string | null, language?: string) => {
    closeEventSource()
    if (voiceExample !== undefined) voiceExampleRef.current = voiceExample
    const resolvedLanguage =
      language
      || readPersistedStoryLanguage()
      || languageRef.current
      || 'en'
    languageRef.current = resolvedLanguage

    void (async () => {
      const auth = await authHeaders()
      const qs = buildStreamQuery({
        voiceExample: voiceExampleRef.current,
        language: resolvedLanguage,
      })
      const commandQuery = runtimeVersionRef.current === 1 && commandRef.current
        ? `&command_id=${encodeURIComponent(commandRef.current)}` : ''
      const streamUrl = `/api/session/${sid}/stream${qs}${commandQuery}`
      const handleEvent = (eventType: string, raw: string) => {
        let payload: { data?: Record<string, unknown> }
        try {
          payload = JSON.parse(raw)
        } catch {
          return
        }
        // Any live event resets the stall watchdog and proves the stream is
        // alive: a scheduled recovery attempt is no longer needed.
        armStallWatchdog(sid)
        clearTurnRetry()
        setCommandNotice(null)
        if (eventType === 'outline') {
          setOutline((payload.data?.content as string) ?? '')
          updateConnectionState('streaming')
          return
        }
        if (eventType === 'status') {
          const msg = String(payload.data?.message ?? '')
          if (msg.includes('continuing automatically')) {
            setAutoContinued(true)
            updateConnectionState('streaming')
          } else {
            appendEvent({ type: 'status', data: payload.data ?? {} })
          }
          return
        }
        if (['player_turn', 'scene_change', 'agent_act', 'agent_think', 'agent_speak', 'world_state_delta'].includes(eventType)) {
          appendEvent({ type: eventType, data: payload.data ?? {} })
          if (connectionStateRef.current === 'connecting') {
            updateConnectionState('streaming')
          }
          return
        }
        if (eventType === 'beat_ready') {
          appendEvent({ type: 'beat_ready', data: payload.data ?? {} })
          const eventRevision = payload.data?.world_revision
          const applyIdentity = shouldApplyStoryIdentity(
            worldRevisionRef.current,
            eventRevision,
          )
          if (typeof eventRevision === 'number') {
            worldRevisionRef.current = Math.max(worldRevisionRef.current, eventRevision)
            runtimeVersionRef.current = 1
          }
          const beatCommandId = typeof payload.data?.command_id === 'string' ? payload.data.command_id : null
          if (beatCommandId) commandRef.current = beatCommandId
          if (applyIdentity && typeof payload.data?.player_actor_id === 'string') {
            setPlayerActorId(payload.data.player_actor_id)
          }
          // Only the beat for THIS command settles the local pending ref: a
          // replayed older beat must not drop a newer unacknowledged move.
          const pendingCommand = pendingCommandRef.current
          const pendingCommandId = typeof pendingCommand?.body.command_id === 'string'
            ? pendingCommand.body.command_id
            : null
          if (pendingCommand && (
            (beatCommandId !== null && pendingCommandId === beatCommandId)
            || (beatCommandId === null && pendingCommandId === null)
          )) {
            pendingCommandRef.current = null
          }
          const beatId = typeof payload.data?.beat_id === 'string' ? payload.data.beat_id : null
          const parsedBeatIndex = beatIndexFromBeatId(beatId)
          const isFinal = payload.data?.is_final === true
          setCurrentBeatId(beatId)
          setBeatIndex((prev) => parsedBeatIndex ?? prev + 1)
          setAutoContinued(false)
          stallReconnectRef.current = false
          bindingRecoverTriedRef.current = false
          setStreamFailure(null)
          updateConnectionState(isFinal ? 'complete' : 'beat_paused')
          closeEventSource()
          return
        }
        if (eventType === 'complete') {
          if (
            shouldApplyStoryIdentity(
              worldRevisionRef.current,
              payload.data?.world_revision,
            )
            && typeof payload.data?.player_actor_id === 'string'
          ) {
            setPlayerActorId(payload.data.player_actor_id)
          }
          appendEvent({ type: 'complete', data: payload.data ?? {} })
          stallReconnectRef.current = false
          bindingRecoverTriedRef.current = false
          setStreamFailure(null)
          updateConnectionState('complete')
          closeEventSource()
          return
        }
        if (eventType === 'error') {
          setSessionError(String(payload.data?.message ?? 'Unknown error'))
          appendEvent({ type: 'error', data: payload.data ?? {} })
          setStreamFailure({ kind: 'unknown', message: String(payload.data?.message ?? 'Unknown error') })
          updateConnectionState('error')
          closeEventSource()
        }
      }

      if (import.meta.env.DEV && typeof window !== 'undefined') {
        ;(window as Window & { __storyHandleEvent?: typeof handleEvent }).__storyHandleEvent = handleEvent
      }

      const handleUnexpectedTransportEnd = () => {
        // A response that ends without beat_ready / complete / error is a
        // failed stream, even when the TCP connection itself closed cleanly.
        closeEventSource()
        const verdict = transportEndVerdict(
          connectionStateRef.current,
          stallReconnectRef.current,
        )
        if (verdict === 'ignore') return
        if (verdict === 'retry') {
          // 'connecting' gets the same single silent retry as 'streaming':
          // a manual reconnect whose first response closes before any event
          // must not pop an error card.
          stallReconnectRef.current = true
          connectStreamRef.current(sid, undefined, undefined)
          return
        }
        setStreamFailure({
          kind: 'network',
          message:
            'The connection to the director dropped and one reconnect already failed. Your progress is saved — retry when ready.',
        })
        updateConnectionState('error')
      }

      const es = openFetchSse(streamUrl, {
        headers: buildStreamHeaders({
          connectionSessionId: connectionSessionRef.current,
          extra: auth,
        }),
        onEvent: handleEvent,
        // P1 heartbeat: `: ping` comment frames never reach onEvent, but any
        // byte from the server proves the connection is alive — re-arm the
        // watchdog so a slow-but-live Director no longer triggers a stall
        // reconnect (which re-bills the beat).
        onActivity: () => armStallWatchdog(sid),
        onHttpError: (status, body) => {
          const detailCode = (() => {
            const detail = (body as { detail?: { code?: unknown } } | null)?.detail
            return typeof detail === 'object' && detail && typeof detail.code === 'string'
              ? detail.code
              : null
          })()
          // P0: another stream still holds the generation token for this
          // command. That is NOT a failure: the server already has the move,
          // nothing is re-POSTed, nothing is billed again. Wait, re-ask
          // /state, and reconnect to the same command until it commits.
          if (status === 409 && detailCode === 'turn_in_progress') {
            setNotice('confirming')
            scheduleTurnRecovery(sid, commandRef.current || '')
            return
          }
          // P0: the command we asked for is not pending and has no saved
          // events (stopped elsewhere, or never enqueued). Ask the server
          // what it really holds instead of showing a raw 409.
          if (status === 409 && (detailCode === 'not_pending' || detailCode === 'turn_not_found')) {
            if (commandRef.current) {
              void recoverTurn(sid, commandRef.current)
            } else {
              setStreamFailure({ kind: 'http', message: 'This beat is no longer available. Continue to go on.' })
              updateConnectionState('beat_paused')
            }
            return
          }
          // P0: the run was stopped (this tab or another one). Abandon the
          // local session instead of pretending the stream broke.
          if (status === 409 && detailCode === 'story_paused') {
            clearTurnRetry()
            clearStorySessionState({ clearStorage: true })
            setResumeToast(RESUME_EXPIRED_TOAST)
            return
          }
          // P3: lost BYOK binding (server restarted after we bound).
          // One silent rebind from the vault, then resume the SAME beat —
          // the platform meter is never touched on this path.
          if (status === 410) {
            const recover = bindingRecoverRef.current
            if (recover && !bindingRecoverTriedRef.current) {
              bindingRecoverTriedRef.current = true
              void (async () => {
                const newSid = await recover()
                if (newSid) {
                  connectionSessionRef.current = newSid
                  connectStreamRef.current(sid, undefined, undefined)
                } else {
                  setStreamFailure({
                    kind: 'binding',
                    message:
                      'Your saved provider-key link expired and could not be restored. Reconnect your key — your story progress is saved.',
                  })
                  updateConnectionState('error')
                }
              })()
              return
            }
            setStreamFailure({
              kind: 'binding',
              message:
                'Your saved provider-key link expired (server restart). Reconnect your key to continue — your story progress is saved.',
            })
            updateConnectionState('error')
            closeEventSource()
            return
          }
          const detail = (body as { detail?: { message?: string } | string } | null)?.detail
          const rawMsg =
            (detail && typeof detail === 'object' && detail.message)
            || (typeof detail === 'string' ? detail : null)
          const msg =
            rawMsg
            || (status === 402
              ? 'Free demo credits used up for today. Sign in for early-access credits or connect your own key.'
              : status === 429
                ? 'Too many requests. Slow down or use your own key.'
                : status === 403
                  ? 'This story session is locked to another browser.'
                  : 'Could not start the story stream.')
          // QA P0#2: classify provider-exhaustion so the UI can speak plainly.
          // 402 gets its own kind: the quota wall needs different actions
          // (connect key / sign in) than a broken stream (reconnect).
          const kind: 'http' | 'quota' = status === 402 ? 'quota' : 'http'
          setStreamFailure({
            kind,
            message: status === 402 && !rawMsg
              ? msg
              : `Story stream failed (${status}). ${msg}`,
          })
          setSessionError(String(msg))
          updateConnectionState('error')
          closeEventSource()
        },
        onNetworkError: handleUnexpectedTransportEnd,
        onClose: handleUnexpectedTransportEnd,
      })
      esRef.current = es
      armStallWatchdog(sid)
    })()
  }, [appendEvent, armStallWatchdog, clearStorySessionState, clearTurnRetry, closeEventSource,
      recoverTurn, scheduleTurnRecovery, setCommandNotice, setNotice, setSessionError,
      updateConnectionState])

  useEffect(() => {
    connectStreamRef.current = connectStream
  }, [connectStream])

  const startStory = useCallback(async (
    taskPrompt: string,
    characterId = 'walter',
    voiceExample?: string | null,
    language?: string,
    connectionSessionId?: string | null,
    scenarioId: 'conversation' | 'desert_crisis' = 'conversation',
  ): Promise<void> => {
    clearStorySessionState()
    setSessionError(null)
    setStreamFailure(null)
    stallReconnectRef.current = false
    bindingRecoverTriedRef.current = false
    updateConnectionState('connecting')
    const resolvedLanguage = language || readPersistedStoryLanguage() || 'en'
    languageRef.current = resolvedLanguage
    voiceExampleRef.current = voiceExample ?? null
    if (connectionSessionId !== undefined) {
      connectionSessionRef.current = connectionSessionId
    }

    try {
      const res = await fetch('/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          title: taskPrompt.slice(0, 80),
          task_prompt: taskPrompt,
          active_character_id: characterId,
          language: resolvedLanguage,
          scenario_id: scenarioId,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to create session' }))
        throw new Error(err.detail || 'Session creation failed')
      }
      const data = await res.json()
      const sid = data.session_id as string
      const skey = typeof data.session_key === 'string' ? data.session_key : null
      runtimeVersionRef.current = data.runtime_version === 1 ? 1 : 0
      worldRevisionRef.current = typeof data.world_revision === 'number' ? data.world_revision : 0
      commandRef.current = typeof data.command_id === 'string' ? data.command_id : null
      setSessionId(sid)
      setPlayerActorId(characterId)
      sessionRef.current = sid
      writeSavedSessionId(sid, skey)
      connectStream(sid, voiceExampleRef.current, resolvedLanguage)
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'Unknown error')
      updateConnectionState('error')
    }
  }, [clearStorySessionState, connectStream, setSessionError, updateConnectionState])

  const resumeSession = useCallback(async (sid: string): Promise<void> => {
    setIsResuming(true)
    sessionRef.current = sid
    updateConnectionState('connecting')
    setSessionError(null)

    try {
      const stateRes = await fetch(`/api/session/${sid}/state`, { headers: sessionAuthHeaders() })
      if (stateRes.ok) {
        const snapshot = await stateRes.json()
        if (snapshot.runtime_version === 1) {
          runtimeVersionRef.current = 1
          worldRevisionRef.current = snapshot.world_revision
          commandRef.current = snapshot.command_id
          setPlayerActorId(
            typeof snapshot.player_actor_id === 'string'
              ? snapshot.player_actor_id
              : typeof snapshot.world?.player_id === 'string'
                ? snapshot.world.player_id
                : null,
          )
          setOutline(typeof snapshot.outline === 'string' ? snapshot.outline : null)
          pendingCommandRef.current = null
          const restored = (snapshot.events ?? []) as StoryEvent[]
          const latestReady = [...restored].reverse().find((event) => event.type === 'beat_ready')
          const beatId = typeof latestReady?.data.beat_id === 'string' ? latestReady.data.beat_id : null
          setEvents(restored)
          setSessionId(sid)
          setCurrentBeatId(beatId)
          setBeatIndex(beatIndexFromBeatId(beatId) ?? 0)
          if (snapshot.status === 'stopped') {
            // Stop is terminal for this local session: drop the key and return
            // to idle instead of offering Continue controls for a run that
            // will only answer 409 story_stopped.
            clearStorySessionState({ clearStorage: true })
            setResumeToast(RESUME_EXPIRED_TOAST)
            return
          }
          if (snapshot.status === 'complete') {
            updateConnectionState('complete')
          } else if (typeof snapshot.pending_command_id === 'string' && snapshot.pending_command_id) {
            // The action was accepted before the page disappeared, but its
            // saved result has not been delivered yet. Resume that exact
            // command instead of asking the player to submit a second one.
            commandRef.current = snapshot.pending_command_id
            updateConnectionState('connecting')
            connectStream(
              sid,
              voiceExampleRef.current,
              languageRef.current || readPersistedStoryLanguage(),
            )
          } else {
            updateConnectionState('beat_paused')
          }
          return
        }
      } else if (stateRes.status !== 404) {
        throw new Error(`Failed to restore story state (${stateRes.status})`)
      }
      const res = await fetch(`/api/session/${sid}/messages`, {
        headers: { ...sessionAuthHeaders() },
      })
      if (res.status === 404) {
        // Session no longer exists — clear storage and return to idle.
        clearStorySessionState({ clearStorage: true })
        return
      }
      if (!res.ok) {
        throw new Error(`Failed to fetch session history (${res.status})`)
      }
      const msgs = (await res.json()) as MessageOut[]
      const restoredProgress = deriveBeatProgressFromMessages(msgs)
      const restoredEvents: StoryEvent[] = msgs.map((msg) => ({
        type: 'agent_speak',
        data: {
          character_id: msg.character_name,
          content: msg.content,
          emotion_state: msg.emotion_state,
          gif_search_query: msg.gif_search_query,
          beat_id: msg.beat_id,
        },
        received_at: Date.now(),
      }))
      setEvents(restoredEvents)
      setSessionId(sid)
      setCurrentBeatId(restoredProgress.beatId)
      setBeatIndex(restoredProgress.beatIndex)
      // The /messages endpoint only returns persisted messages; we don't
      // know the true server-side session state. Default to 'beat_paused'
      // so the UI shows the Continue/Stop controls and lets the user
      // decide. Do NOT auto-connect the SSE stream — the user clicks
      // Continue to resume streaming (which triggers the next beat).
      updateConnectionState('beat_paused')
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'Failed to resume session')
      updateConnectionState('error')
    } finally {
      setIsResuming(false)
    }
  }, [clearStorySessionState, connectStream, setSessionError, updateConnectionState])

  const sendAction = useCallback(async (action: StoryAction, params?: StoryActionParams, characterId?: string): Promise<boolean> => {
    const sid = sessionRef.current
    if (!sid) return false

    // M9: Abort any in-flight fetch from a previous sendAction before starting a new one.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller
    /* A POST that never settles must not leave the player on a spinner with
     * no stream, no watchdog and no controls: after this deadline the request
     * is aborted and treated exactly like a dropped connection. */
    let actionTimedOut = false
    const actionDeadline = window.setTimeout(() => {
      actionTimedOut = true
      controller.abort()
    }, ACTION_DEADLINE_MS)

    if (action === 'stop') {
      // The visible generation stops NOW — the player asked for it. Any
      // recovery already in flight (probe or resend) is aborted and
      // invalidated here, so nothing late can reopen a stream or commit after
      // the player stopped.
      window.clearTimeout(actionDeadline)
      recoveryEpochRef.current += 1
      activeRecoveryCommandRef.current = null
      abortActiveRecovery()
      closeEventSource()
      clearTurnRetry()
      const outcome = await requestStop(sid, controller.signal)
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
      if (outcome === 'aborted') {
        // Aborted because our own deadline fired: the server never answered,
        // so tell the player instead of failing silently.
        if (actionTimedOut) {
          setNotice('stopFailed')
          updateConnectionState('beat_paused')
        }
        return false
      }
      if (outcome === 'unconfirmed') {
        // The server never confirmed: keep the session key so the player can
        // ask again instead of permanently orphaning a run that may still be
        // generating (and billing) on the server.
        setNotice('stopFailed')
        updateConnectionState('beat_paused')
        return false
      }
      // Confirmed stopped (or the session is gone) — clear localStorage so we
      // don't auto-resume a stopped session on next page refresh.
      setNotice(null)
      clearStorySessionState({ clearStorage: true })
      return true
    }

    const signature = JSON.stringify([sid, action, params ?? {}, worldRevisionRef.current])
    // P0: a different action must not silently replace a move the server has
    // not accounted for yet — the player would lose the move they made.
    const prior = pendingCommandRef.current
    const priorCommandId = prior && typeof prior.body.command_id === 'string'
      ? prior.body.command_id : null
    if (prior && prior.signature !== signature && priorCommandId) {
      const reality = await recoverTurn(sid, priorCommandId, { resend: false })
      if (reality === 'missing' || reality === 'stopped') return false
      if (reality === 'pending' || reality === 'committed' || reality === 'unknown') {
        setNotice('refused')
        return false
      }
      // 'absent' / 'complete' / 'paused': the server never received it, so no
      // orphan line may stay in the manuscript. Continue with the new move.
      setEvents(prev => settleCommandEvents(prev, priorCommandId, 'absent'))
      pendingCommandRef.current = null
      setNotice(null)
    }
    const body = pendingCommandRef.current?.signature === signature
      ? pendingCommandRef.current.body
      : buildStoryCommand(action, params ?? {}, {
        runtimeVersion: runtimeVersionRef.current, revision: worldRevisionRef.current,
        commandId: crypto.randomUUID(),
      })
    pendingCommandRef.current = { signature, body, ack: 'unconfirmed' }
    const commandId = typeof body.command_id === 'string' ? body.command_id : null
    // Starting a new command cancels the previous one's recovery: its timers
    // and in-flight requests are dropped, and anything that answers later is
    // stale.
    abortActiveRecovery()
    clearTurnRetry()
    if (commandId) activeRecoveryCommandRef.current = commandId
    const optimisticEventId = action === 'act'
      ? (commandId ? `${commandId}:0` : `client:${crypto.randomUUID()}`)
      : null
    if (action === 'act' && params?.player_input) {
      appendEvent({
        type: 'player_turn',
        data: {
          kind: params.player_kind ?? 'free',
          content: params.player_input,
          event_id: optimisticEventId,
          // Not committed story text until the server says so.
          pending: true,
          ...(commandId ? { command_id: commandId } : {}),
        },
      })
    }

    if (
      action === 'continue'
      || action === 'act'
      || action === 'switch_perspective'
      || action === 'redirect'
      || action === 'continue_chapter'
      || action === 'branch'
      || action === 'replay'
    ) {
      updateConnectionState('streaming')
    }

    // M8: per-character isSending/error state
    if (characterId) {
      setIsSendingByChar(prev => ({ ...prev, [characterId]: true }))
      setErrorByChar(prev => ({ ...prev, [characterId]: null }))
    }

    try {
      const res = await fetch(`/api/session/${sid}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Action failed' }))
        const detail = err.detail
        const code = typeof detail === 'object' && detail
          ? (detail as { code?: string }).code : undefined
        const message = typeof detail === 'string' ? detail : code || 'Action failed'
        if (typeof detail?.world_revision === 'number') worldRevisionRef.current = detail.world_revision
        // Another command is still being generated: the server keeps its
        // accepted move, our new one never existed. Drop the local line and
        // follow the command the SERVER holds — not the one it just rejected.
        if (res.status === 409 && code === 'turn_in_progress') {
          if (optimisticEventId) {
            setEvents(prev => prev.filter(event => event.data?.event_id !== optimisticEventId))
          }
          if (pendingCommandRef.current) pendingCommandRef.current.ack = 'rejected'
          pendingCommandRef.current = null
          setNotice('confirming')
          void (async () => {
            if (!(await adoptServerCommand(sid))) {
              // Nothing recoverable on the server: leave the spinner behind.
              updateConnectionState('beat_paused')
            }
          })()
          return false
        }
        if (res.status === 409 && code === 'story_stopped') {
          // The run was stopped elsewhere; there is nothing left to act on.
          clearTurnRetry()
          clearStorySessionState({ clearStorage: true })
          setResumeToast(RESUME_EXPIRED_TOAST)
          return false
        }
        if (res.status >= 500) {
          // A 5xx does NOT say the command was rejected — the server may have
          // accepted and committed it before failing to answer. Treat it as an
          // uncertain acknowledgement (same path as a dropped connection).
          if (commandId) commandRef.current = commandId
          setNotice('unconfirmed')
          updateConnectionState('beat_paused')
          void recoverWithFallback(sid, commandId ?? '')
          return false
        }
        // A definite rejection: the command does not exist on the server.
        if (pendingCommandRef.current) pendingCommandRef.current.ack = 'rejected'
        pendingCommandRef.current = null
        if (optimisticEventId) {
          setEvents(prev => prev.filter(event => event.data?.event_id !== optimisticEventId))
        }
        if (characterId) {
          setErrorByChar(prev => ({ ...prev, [characterId]: message }))
        }
        // Roll back optimistic state so user can retry from beat_paused
        // (action !== 'stop' here — stop returned early above)
        updateConnectionState('beat_paused')
        return false
      }
      const accepted = await res.json()
      if (accepted.runtime_version === 1) {
        runtimeVersionRef.current = 1
        worldRevisionRef.current = accepted.world_revision
        commandRef.current = accepted.command_id
      }
      // Accepted is not committed: keep the id so the stream (and any 409
      // recovery) can ask for this exact command. beat_ready clears it.
      if (pendingCommandRef.current) pendingCommandRef.current.ack = 'pending'
      if (action === 'replay' && params?.beat_id) {
        setEvents(prev => trimFeedForBeatRedraw(prev, params.beat_id as string))
      }
      if (action === 'branch' && params?.from_beat_id) {
        setEvents(prev => trimFeedThroughBeat(prev, params.from_beat_id as string))
      }

      // A restored session has message history but no live EventSource.
      // After the action succeeds, open a fresh stream so Continue,
      // Redirect, and Switch Perspective can actually receive new events.
      // MUST pass persisted language/voice — beat_paused closes the previous
      // EventSource, so this is a brand-new connection (not a keep-alive).
      if (!esRef.current) {
        connectStream(sid, voiceExampleRef.current, languageRef.current || readPersistedStoryLanguage())
      }
      return true
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError' && !actionTimedOut) {
        // Aborted by a newer sendAction or stop — don't set error, don't change connectionState.
        // isSending is cleared in finally.
      } else if (commandId) {
        // The POST failed with no protocol answer. The command may or may not
        // exist server-side, so ask /state with the SAME command id instead of
        // guessing (and never make the player retype the line). The player is
        // back on the last COMMITTED beat while that probe runs: the pending
        // command is marked in the manuscript and no new one may replace it.
        // commandRef moves to the command under recovery so a manual
        // reconnect can never replay an older beat instead of this one.
        commandRef.current = commandId
        setNotice('unconfirmed')
        updateConnectionState('beat_paused')
        void recoverWithFallback(sid, commandId)
      } else {
        if (characterId) {
          setErrorByChar(prev => ({ ...prev, [characterId]: e instanceof Error ? e.message : 'Action failed' }))
        }
        updateConnectionState('beat_paused')
      }
      return false
    } finally {
      window.clearTimeout(actionDeadline)
      if (characterId) {
        setIsSendingByChar(prev => ({ ...prev, [characterId]: false }))
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }, [abortActiveRecovery, adoptServerCommand, appendEvent, clearStorySessionState, clearTurnRetry,
      closeEventSource, connectStream, recoverTurn, recoverWithFallback, requestStop, setNotice,
      updateConnectionState])

  const redrawBeat = useCallback(async (beatId: string, characterId?: string) => {
    await sendAction('replay', { beat_id: beatId }, characterId)
  }, [sendAction])

  const reconnect = useCallback(() => {
    const sid = sessionRef.current
    if (!sid) return
    setSessionError(null)
    // P0: go through updateConnectionState so the ref matches React state
    // synchronously — a direct setter left the ref on 'streaming' for one
    // render, which made the closing old transport look like a failure.
    updateConnectionState('connecting')
    clearTurnRetry()
    // A manual retry is a fresh decision: give it its own silent-reconnect
    // budget, so a first response that closes before any event does not
    // immediately fail the stream the player just asked for.
    stallReconnectRef.current = false
    bindingRecoverTriedRef.current = false
    connectStream(sid, voiceExampleRef.current, languageRef.current || readPersistedStoryLanguage())
  }, [clearTurnRetry, connectStream, setSessionError, updateConnectionState])

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    clearStorySessionState({ clearStorage: true, clearCharacterFeedback: true })
  }, [clearStorySessionState])

  // Auto-resume on mount if a sessionId is saved in localStorage.
  // Guarded by a ref to avoid duplicate triggers (React strict mode, etc.)
  // P0-3: probe first. If the backend still has the session,
  // transition to 'connecting' via resumeSession (expected behavior).
  // If the backend returns 404, clear storage and surface a toast.
  // Do NOT set connectionState to 'connecting', so the typing dots
  // never appear in the dead-session case.
  useEffect(() => {
    // Merely opening an independent chat must not resume/generate a saved
    // Story in the background. An already opened run keeps its live state.
    if (!autoResume || sessionRef.current) return
    if (hasAttemptedResumeRef.current) return
    hasAttemptedResumeRef.current = true

    const savedSid = readSavedSessionId()
    if (!savedSid) return

    let cancelled = false
    setIsResuming(true)
    ;(async () => {
      const probe = await pingSession(savedSid)
      if (cancelled) return
      if (probe === 'alive') {
        resumeSession(savedSid)
      } else if (probe === 'missing') {
        // Session is gone — clear storage and tell the user, but stay idle.
        clearSavedSessionId()
        setSessionError(null)
        setIsResuming(false)
        updateConnectionState('idle')
        setResumeToast(RESUME_EXPIRED_TOAST)
      } else {
        setSessionError(null)
        setIsResuming(false)
        updateConnectionState('idle')
        setResumeToast(RESUME_RETRY_TOAST)
      }
    })()

    return () => {
      cancelled = true
      hasAttemptedResumeRef.current = false
    }
  }, [autoResume, resumeSession, setSessionError, updateConnectionState])

  // Auto-dismiss the resume toast after 8s. Each time ``resumeToast``
  // transitions to a non-null value (including identical text back-to-back)
  // we bump a counter so the effect re-runs even when the value is the
  // same — otherwise React's `Object.is` check would skip the re-arm.
  const toastEpochRef = useRef(0)
  useEffect(() => {
    if (!resumeToast) return
    toastEpochRef.current += 1
    const id = window.setTimeout(() => setResumeToast(null), 8000)
    return () => window.clearTimeout(id)
  }, [resumeToast])

  // M9: abort in-flight fetch on unmount to prevent leaked requests and stale updates.
  useEffect(() => {
    return () => {
      recoveryEpochRef.current += 1
      activeRecoveryCommandRef.current = null
      abortActiveRecovery()
      closeEventSource()
      clearTurnRetry()
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [abortActiveRecovery, clearTurnRetry, closeEventSource])

  const dismissResumeToast = useCallback(() => setResumeToast(null), [])

  const getCharState = useCallback((characterId: string): { isSending: boolean; error: string | null } => ({
    isSending: !!isSendingByChar[characterId],
    error: errorByChar[characterId] ?? errorByChar['__session__'] ?? null,
  }), [isSendingByChar, errorByChar])

  return {
    events,
    outline,
    sessionId,
    playerActorId,
    connectionState,
    currentBeatId,
    beatIndex,
    isSendingByChar,
    errorByChar,
    autoContinued,
    streamFailure,
    commandNotice,
    setConnectionSessionId,
    setBindingRecover,
    isResuming,
    resumeToast,
    startStory,
    sendAction,
    appendLocalEvent: appendEvent,
    redrawBeat,
    reconnect,
    reset,
    resumeSession,
    dismissResumeToast,
    getCharState,
  }
}
