/* =================================================================
   ABQ Roleplay Lab — useStoryStream (SSE real-time streaming)
   Connects to backend /api/session/{id}/stream via EventSource.
   Player decisions at beat_ready affect real plot progression.
   ================================================================= */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface StoryEvent {
  type: string
  data: Record<string, unknown>
  received_at?: number
}

export type StoryConnectionState =
  | 'idle' | 'connecting' | 'streaming'
  | 'beat_paused' | 'complete' | 'error'

export type StoryAction =
  | 'continue'
  | 'stop'
  | 'redirect'
  | 'switch_perspective'
  | 'continue_chapter'
  | 'branch'
  | 'replay'

export interface StoryActionParams {
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

/* ----- Maximum number of events retained in memory.
 * Long streaming sessions can produce hundreds of events; capping the
 * array bounds memory growth and keeps the rendered event feed cheap.
 * Oldest events are dropped when the cap is exceeded. */
const MAX_EVENTS = 200

function readSavedSessionId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeSavedSessionId(sid: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, sid)
  } catch {
    /* ignore storage errors */
  }
}

function clearSavedSessionId(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    /* ignore storage errors */
  }
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
    const res = await fetch(`/api/session/${sid}/messages?limit=1`, { method: 'GET' })
    if (res.ok) return 'alive'
    if (res.status === 404) return 'missing'
    return 'error'
  } catch {
    return 'error'
  }
}

/* ----- Auto-resume toast text (English copy; not localized.
 * This only fires when an existing saved session is gone). */
const RESUME_EXPIRED_TOAST = 'Your last session expired (deleted or server reset). Start a new one.'
const RESUME_RETRY_TOAST = 'Could not verify your last session. Try again when the server is reachable.'

/* ----- Event dedup key: identifies duplicate events on reconnect -----
 * SSE events have no unique ID, so we synthesize a key from stable content.
 * Only dedup event types with clear identifying data (agent_speak content,
 * beat_ready beat_id). For other types, fall back to type+received_at so
 * duplicates are allowed (better to show twice than miss an event). */
function dedupKey(evt: StoryEvent): string {
  const d = evt.data || {}
  if (evt.type === 'agent_speak' && d.content) return `speak:${d.character_id}:${d.content}`
  if (evt.type === 'beat_ready' && d.beat_id) return `beat:${d.beat_id}`
  return `${evt.type}:${evt.received_at ?? Date.now()}`
}

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

export interface UseStoryStreamReturn {
  events: StoryEvent[]
  outline: string | null
  sessionId: string | null
  connectionState: StoryConnectionState
  currentBeatId: string | null
  beatIndex: number
  isSendingByChar: Record<string, boolean>
  errorByChar: Record<string, string | null>
  autoContinued: boolean
  isResuming: boolean
  resumeToast: string | null
  startStory: (taskPrompt: string, characterId?: string, voiceExample?: string | null, language?: string) => Promise<void>
  sendAction: (action: StoryAction, params?: StoryActionParams, characterId?: string) => Promise<void>
  reconnect: () => void
  reset: () => void
  resumeSession: (sid: string) => Promise<void>
  dismissResumeToast: () => void
  getCharState: (characterId: string) => { isSending: boolean; error: string | null }
}

export function useStoryStream(): UseStoryStreamReturn {
  const [events, setEvents] = useState<StoryEvent[]>([])
  const [outline, setOutline] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  // P0-3: do NOT pre-set 'connecting' just because localStorage has a
  // savedSid. The auto-resume effect will probe session history first; only if
  // the backend confirms the session exists will it transition to
  // 'connecting'. This eliminates the 1–3s "Connecting…" flash when the
  // saved sessionId is stale (404).
  const [connectionState, setConnectionState] = useState<StoryConnectionState>('idle')
  const [currentBeatId, setCurrentBeatId] = useState<string | null>(null)
  const [beatIndex, setBeatIndex] = useState(0)
  const [isSendingByChar, setIsSendingByChar] = useState<Record<string, boolean>>({})
  const [errorByChar, setErrorByChar] = useState<Record<string, string | null>>({})
  const [autoContinued, setAutoContinued] = useState(false)
  // Same fix as connectionState: don't claim we're "resuming" until the
  // session-history probe confirms the session is still alive.
  const [isResuming, setIsResuming] = useState<boolean>(false)
  const [resumeToast, setResumeToast] = useState<string | null>(null)

  const esRef = useRef<EventSource | null>(null)
  const sessionRef = useRef<string | null>(null)
  const hasAttemptedResumeRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const closeEventSource = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
  }, [])

  const setSessionError = useCallback((err: string | null) => {
    setErrorByChar(prev => ({ ...prev, '__session__': err }))
  }, [])

  const clearStorySessionState = useCallback((options?: {
    clearStorage?: boolean
    clearCharacterFeedback?: boolean
  }) => {
    closeEventSource()
    setEvents([])
    setOutline(null)
    setSessionId(null)
    setCurrentBeatId(null)
    setBeatIndex(0)
    setAutoContinued(false)
    setConnectionState('idle')
    sessionRef.current = null
    if (options?.clearCharacterFeedback) {
      setIsSendingByChar({})
      setErrorByChar({})
    }
    if (options?.clearStorage) {
      clearSavedSessionId()
    }
  }, [closeEventSource])

  const appendEvent = useCallback((evt: StoryEvent) => {
    setEvents((prev) => {
      const key = dedupKey(evt)
      if (prev.some((e) => dedupKey(e) === key)) return prev // skip duplicate
      const next = [...prev, { ...evt, received_at: Date.now() }]
      // Bound memory in long sessions: drop oldest events beyond MAX_EVENTS.
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
    })
  }, [])

  const connectStream = useCallback((sid: string, voiceExample?: string | null, language?: string) => {
    closeEventSource()
    const parts: string[] = []
    if (voiceExample) parts.push(`voice_example=${encodeURIComponent(voiceExample)}`)
    if (language) parts.push(`language=${encodeURIComponent(language)}`)
    const qs = parts.length ? `?${parts.join('&')}` : ''
    const es = new EventSource(`/api/session/${sid}/stream${qs}`)
    esRef.current = es

    es.addEventListener('outline', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data)
        setOutline(payload.data?.content ?? '')
        setConnectionState('streaming')
      } catch { /* ignore parse error */ }
    })

    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data)
        const msg = payload.data?.message ?? ''
        if (msg.includes('continuing automatically')) {
          setAutoContinued(true)
          setConnectionState('streaming')
        } else {
          appendEvent({ type: 'status', data: payload.data })
        }
      } catch { /* ignore */ }
    })

    const appendTypes = ['scene_change', 'agent_act', 'agent_think', 'agent_speak', 'world_state_delta']
    appendTypes.forEach((t) => {
      es.addEventListener(t, (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data)
          appendEvent({ type: t, data: payload.data })
        } catch { /* ignore */ }
      })
    })

    es.addEventListener('beat_ready', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data)
        const beatId = typeof payload.data?.beat_id === 'string' ? payload.data.beat_id : null
        const parsedBeatIndex = beatIndexFromBeatId(beatId)
        setCurrentBeatId(beatId)
        setBeatIndex((prev) => parsedBeatIndex ?? prev + 1)
        setAutoContinued(false)
        setConnectionState('beat_paused')
      } catch { /* ignore */ }
    })

    es.addEventListener('complete', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data)
        appendEvent({ type: 'complete', data: payload.data })
      } catch { /* ignore */ }
      setConnectionState('complete')
      closeEventSource()
    })

    es.addEventListener('error', (e: MessageEvent) => {
      // Distinguish SSE connection error vs backend error event.
      // Backend error events have data; transport-layer errors don't.
      if (e.data) {
        // Server-sent `event: error` message — fatal backend error.
        try {
          const payload = JSON.parse(e.data)
          setSessionError(payload.data?.message ?? 'Unknown error')
          appendEvent({ type: 'error', data: payload.data })
        } catch {
          setSessionError('Stream error')
        }
        setConnectionState('error')
        closeEventSource()
        return
      }
      // Transport-layer error (no e.data) — may be transient.
      // Do NOT unconditionally close: EventSource auto-reconnects when
      // readyState is CONNECTING. Only treat as fatal if the connection
      // was forcibly closed (readyState === CLOSED).
      if (es.readyState === EventSource.CLOSED) {
        setSessionError('SSE connection closed')
        setConnectionState('error')
        closeEventSource()
      }
      // readyState === CONNECTING → transient disconnect, let EventSource
      // retry natively. No state change, no close.
    })
  }, [appendEvent, closeEventSource, setSessionError])

  const startStory = useCallback(async (taskPrompt: string, characterId = 'walter', voiceExample?: string | null, language?: string): Promise<void> => {
    clearStorySessionState()
    setSessionError(null)
    setConnectionState('connecting')

    try {
      const res = await fetch('/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskPrompt.slice(0, 80),
          task_prompt: taskPrompt,
          active_character_id: characterId,
          language: language || 'en',
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to create session' }))
        throw new Error(err.detail || 'Session creation failed')
      }
      const data = await res.json()
      const sid = data.session_id as string
      setSessionId(sid)
      sessionRef.current = sid
      writeSavedSessionId(sid)
      connectStream(sid, voiceExample, language)
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'Unknown error')
      setConnectionState('error')
    }
  }, [clearStorySessionState, connectStream, setSessionError])

  const resumeSession = useCallback(async (sid: string): Promise<void> => {
    setIsResuming(true)
    sessionRef.current = sid
    setConnectionState('connecting')
    setSessionError(null)

    try {
      const res = await fetch(`/api/session/${sid}/messages`)
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
      setConnectionState('beat_paused')
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'Failed to resume session')
      setConnectionState('error')
    } finally {
      setIsResuming(false)
    }
  }, [clearStorySessionState, setSessionError])

  const sendAction = useCallback(async (action: StoryAction, params?: StoryActionParams, characterId?: string): Promise<void> => {
    const sid = sessionRef.current
    if (!sid) return

    // M9: Abort any in-flight fetch from a previous sendAction before starting a new one.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    if (action === 'stop') {
      try {
        await fetch(`/api/session/${sid}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop' }),
          signal: controller.signal,
        })
      } catch (e) {
        // ignore — we close locally regardless (abort or network error)
        if (!(e instanceof Error && e.name === 'AbortError')) {
          // non-abort error: still proceed with local cleanup
        }
      }
      // User explicitly stopped — clear localStorage so we don't auto-resume
      // a stopped session on next page refresh (defeats the purpose of Stop).
      clearStorySessionState({ clearStorage: true })
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
      return
    }

    const body: Record<string, unknown> = { action }
    if (action === 'redirect' && params?.redirect_prompt) {
      body.redirect_prompt = params.redirect_prompt
    }
    if (action === 'switch_perspective' && params?.target_character) {
      body.target_character = params.target_character
    }
    if (action === 'branch' && params?.from_beat_id) {
      body.from_beat_id = params.from_beat_id
      if (params.branch_goal) body.branch_goal = params.branch_goal
    }
    if (action === 'continue_chapter' && params?.branch_goal) {
      body.branch_goal = params.branch_goal
    }
    if (action === 'replay' && params?.beat_id) {
      body.beat_id = params.beat_id
    }

    if (
      action === 'continue'
      || action === 'switch_perspective'
      || action === 'redirect'
      || action === 'continue_chapter'
      || action === 'branch'
      || action === 'replay'
    ) {
      setConnectionState('streaming')
    }

    // M8: per-character isSending/error state
    if (characterId) {
      setIsSendingByChar(prev => ({ ...prev, [characterId]: true }))
      setErrorByChar(prev => ({ ...prev, [characterId]: null }))
    }

    try {
      const res = await fetch(`/api/session/${sid}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Action failed' }))
        if (characterId) {
          setErrorByChar(prev => ({ ...prev, [characterId]: err.detail || 'Action failed' }))
        }
        // Roll back optimistic state so user can retry from beat_paused
        // (action !== 'stop' here — stop returned early above)
        setConnectionState('beat_paused')
        return
      }

      // A restored session has message history but no live EventSource.
      // After the action succeeds, open a fresh stream so Continue,
      // Redirect, and Switch Perspective can actually receive new events.
      if (!esRef.current) {
        connectStream(sid)
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // Aborted by a newer sendAction or stop — don't set error, don't change connectionState.
        // isSending is cleared in finally.
      } else {
        if (characterId) {
          setErrorByChar(prev => ({ ...prev, [characterId]: e instanceof Error ? e.message : 'Action failed' }))
        }
        setConnectionState('beat_paused')
      }
    } finally {
      if (characterId) {
        setIsSendingByChar(prev => ({ ...prev, [characterId]: false }))
      }
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }, [clearStorySessionState, connectStream])

  const reconnect = useCallback(() => {
    const sid = sessionRef.current
    if (!sid) return
    setSessionError(null)
    setConnectionState('connecting')
    connectStream(sid)
  }, [connectStream, setSessionError])

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
        setConnectionState('idle')
        setResumeToast(RESUME_EXPIRED_TOAST)
      } else {
        setSessionError(null)
        setIsResuming(false)
        setConnectionState('idle')
        setResumeToast(RESUME_RETRY_TOAST)
      }
    })()

    return () => {
      cancelled = true
      hasAttemptedResumeRef.current = false
    }
  }, [resumeSession, setSessionError])

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
      closeEventSource()
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [closeEventSource])

  const dismissResumeToast = useCallback(() => setResumeToast(null), [])

  const getCharState = useCallback((characterId: string): { isSending: boolean; error: string | null } => ({
    isSending: !!isSendingByChar[characterId],
    error: errorByChar[characterId] ?? errorByChar['__session__'] ?? null,
  }), [isSendingByChar, errorByChar])

  return {
    events,
    outline,
    sessionId,
    connectionState,
    currentBeatId,
    beatIndex,
    isSendingByChar,
    errorByChar,
    autoContinued,
    isResuming,
    resumeToast,
    startStory,
    sendAction,
    reconnect,
    reset,
    resumeSession,
    dismissResumeToast,
    getCharState,
  }
}
