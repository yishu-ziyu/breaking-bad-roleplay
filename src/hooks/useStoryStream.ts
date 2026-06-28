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

export type StoryAction = 'continue' | 'stop' | 'redirect' | 'switch_perspective'

export interface StoryActionParams {
  redirect_prompt?: string
  target_character?: string
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

export interface UseStoryStreamReturn {
  events: StoryEvent[]
  outline: string | null
  sessionId: string | null
  connectionState: StoryConnectionState
  currentBeatId: string | null
  beatIndex: number
  error: string | null
  autoContinued: boolean
  isResuming: boolean
  startStory: (taskPrompt: string, characterId?: string) => Promise<void>
  sendAction: (action: StoryAction, params?: StoryActionParams) => Promise<void>
  reconnect: () => void
  reset: () => void
  resumeSession: (sid: string) => Promise<void>
}

export function useStoryStream(): UseStoryStreamReturn {
  const [events, setEvents] = useState<StoryEvent[]>([])
  const [outline, setOutline] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  // Initialize to 'connecting' if a saved session exists, so the UI shows
  // loading immediately on mount instead of flashing the idle form.
  const [connectionState, setConnectionState] = useState<StoryConnectionState>(() =>
    readSavedSessionId() ? 'connecting' : 'idle',
  )
  const [currentBeatId, setCurrentBeatId] = useState<string | null>(null)
  const [beatIndex, setBeatIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [autoContinued, setAutoContinued] = useState(false)
  const [isResuming, setIsResuming] = useState<boolean>(() => readSavedSessionId() !== null)

  const esRef = useRef<EventSource | null>(null)
  const sessionRef = useRef<string | null>(null)
  const hasAttemptedResumeRef = useRef(false)

  const closeEventSource = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
  }, [])

  const appendEvent = useCallback((evt: StoryEvent) => {
    setEvents((prev) => [...prev, { ...evt, received_at: Date.now() }])
  }, [])

  const connectStream = useCallback((sid: string) => {
    closeEventSource()
    const es = new EventSource(`/api/session/${sid}/stream`)
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
        setCurrentBeatId(payload.data?.beat_id ?? null)
        setBeatIndex((prev) => prev + 1)
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
          setError(payload.data?.message ?? 'Unknown error')
          appendEvent({ type: 'error', data: payload.data })
        } catch {
          setError('Stream error')
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
        setError('SSE connection closed')
        setConnectionState('error')
        closeEventSource()
      }
      // readyState === CONNECTING → transient disconnect, let EventSource
      // retry natively. No state change, no close.
    })
  }, [appendEvent, closeEventSource])

  const startStory = useCallback(async (taskPrompt: string, characterId = 'walter'): Promise<void> => {
    closeEventSource()
    setEvents([])
    setOutline(null)
    setSessionId(null)
    setCurrentBeatId(null)
    setBeatIndex(0)
    setError(null)
    setAutoContinued(false)
    setConnectionState('connecting')

    try {
      const res = await fetch('/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskPrompt.slice(0, 80),
          task_prompt: taskPrompt,
          active_character_id: characterId,
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
      connectStream(sid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setConnectionState('error')
    }
  }, [closeEventSource, connectStream])

  const resumeSession = useCallback(async (sid: string): Promise<void> => {
    setIsResuming(true)
    sessionRef.current = sid
    setConnectionState('connecting')
    setError(null)

    try {
      const res = await fetch(`/api/session/${sid}/messages`)
      if (res.status === 404) {
        // Session no longer exists — clear storage and return to idle.
        clearSavedSessionId()
        closeEventSource()
        setEvents([])
        setOutline(null)
        setSessionId(null)
        sessionRef.current = null
        setCurrentBeatId(null)
        setBeatIndex(0)
        setAutoContinued(false)
        setConnectionState('idle')
        return
      }
      if (!res.ok) {
        throw new Error(`Failed to fetch session history (${res.status})`)
      }
      const msgs = (await res.json()) as MessageOut[]
      const restoredEvents: StoryEvent[] = msgs.map((msg) => ({
        type: 'agent_speak',
        data: {
          character_id: msg.character_name,
          content: msg.content,
          emotion_state: msg.emotion_state,
          gif_search_query: msg.gif_search_query,
        },
        received_at: Date.now(),
      }))
      setEvents(restoredEvents)
      setSessionId(sid)
      // The /messages endpoint only returns persisted messages; we don't
      // know the true server-side session state. Default to 'beat_paused'
      // so the UI shows the Continue/Stop controls and lets the user
      // decide. Do NOT auto-connect the SSE stream — the user clicks
      // Continue to resume streaming (which triggers the next beat).
      setConnectionState('beat_paused')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume session')
      setConnectionState('error')
    } finally {
      setIsResuming(false)
    }
  }, [closeEventSource])

  const sendAction = useCallback(async (action: StoryAction, params?: StoryActionParams): Promise<void> => {
    const sid = sessionRef.current
    if (!sid) return

    if (action === 'stop') {
      try {
        await fetch(`/api/session/${sid}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop' }),
        })
      } catch {
        // ignore — we close locally regardless
      }
      closeEventSource()
      setConnectionState('idle')
      setEvents([])
      setOutline(null)
      setSessionId(null)
      sessionRef.current = null
      setBeatIndex(0)
      setCurrentBeatId(null)
      // User explicitly stopped — clear localStorage so we don't auto-resume
      // a stopped session on next page refresh (defeats the purpose of Stop).
      clearSavedSessionId()
      return
    }

    const body: Record<string, unknown> = { action }
    if (action === 'redirect' && params?.redirect_prompt) {
      body.redirect_prompt = params.redirect_prompt
    }
    if (action === 'switch_perspective' && params?.target_character) {
      body.target_character = params.target_character
    }

    if (action === 'continue' || action === 'switch_perspective' || action === 'redirect') {
      setConnectionState('streaming')
    }

    try {
      const res = await fetch(`/api/session/${sid}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Action failed' }))
        setError(err.detail || 'Action failed')
        // Roll back optimistic state so user can retry from beat_paused
        // (action !== 'stop' here — stop returned early above)
        setConnectionState('beat_paused')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
      setConnectionState('beat_paused')
    }
  }, [closeEventSource])

  const reconnect = useCallback(() => {
    const sid = sessionRef.current
    if (!sid) return
    setError(null)
    setConnectionState('connecting')
    connectStream(sid)
  }, [connectStream])

  const reset = useCallback(() => {
    closeEventSource()
    setEvents([])
    setOutline(null)
    setSessionId(null)
    setCurrentBeatId(null)
    setBeatIndex(0)
    setError(null)
    setAutoContinued(false)
    setConnectionState('idle')
    sessionRef.current = null
    clearSavedSessionId()
  }, [closeEventSource])

  // Auto-resume on mount if a sessionId is saved in localStorage.
  // Guarded by a ref to avoid duplicate triggers (React strict mode, etc.)
  useEffect(() => {
    if (hasAttemptedResumeRef.current) return
    hasAttemptedResumeRef.current = true

    const savedSid = readSavedSessionId()
    if (savedSid) {
      resumeSession(savedSid)
    }
  }, [resumeSession])

  useEffect(() => {
    return () => {
      closeEventSource()
    }
  }, [closeEventSource])

  return {
    events,
    outline,
    sessionId,
    connectionState,
    currentBeatId,
    beatIndex,
    error,
    autoContinued,
    isResuming,
    startStory,
    sendAction,
    reconnect,
    reset,
    resumeSession,
  }
}
