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

export interface UseStoryStreamReturn {
  events: StoryEvent[]
  outline: string | null
  sessionId: string | null
  connectionState: StoryConnectionState
  currentBeatId: string | null
  beatIndex: number
  error: string | null
  autoContinued: boolean
  startStory: (taskPrompt: string, characterId?: string) => Promise<void>
  sendAction: (action: StoryAction, params?: StoryActionParams) => Promise<void>
  reconnect: () => void
  reset: () => void
}

export function useStoryStream(): UseStoryStreamReturn {
  const [events, setEvents] = useState<StoryEvent[]>([])
  const [outline, setOutline] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<StoryConnectionState>('idle')
  const [currentBeatId, setCurrentBeatId] = useState<string | null>(null)
  const [beatIndex, setBeatIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [autoContinued, setAutoContinued] = useState(false)

  const esRef = useRef<EventSource | null>(null)
  const sessionRef = useRef<string | null>(null)

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
      // Distinguish SSE connection error vs backend error event
      // Backend error events have data; connection errors don't
      if (e.data) {
        try {
          const payload = JSON.parse(e.data)
          setError(payload.data?.message ?? 'Unknown error')
          appendEvent({ type: 'error', data: payload.data })
        } catch {
          setError('Stream error')
        }
      } else {
        setError('SSE connection lost')
      }
      setConnectionState('error')
      closeEventSource()
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
      connectStream(sid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setConnectionState('error')
    }
  }, [closeEventSource, connectStream])

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
      return
    }

    const body: Record<string, unknown> = { action }
    if (action === 'redirect' && params?.redirect_prompt) {
      body.redirect_prompt = params.redirect_prompt
    }
    if (action === 'switch_perspective' && params?.target_character) {
      body.target_character = params.target_character
    }

    if (action === 'continue') {
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
        if (action === 'continue') setConnectionState('beat_paused')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
      if (action === 'continue') setConnectionState('beat_paused')
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
  }, [closeEventSource])

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
    startStory,
    sendAction,
    reconnect,
    reset,
  }
}
