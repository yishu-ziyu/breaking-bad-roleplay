/* =================================================================
   ABQ Roleplay Lab — useStoryStream (Supabase Realtime)
   Replaces the old SSE-based hook.
   ================================================================= */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface StoryEvent {
  type: string
  data: Record<string, unknown>
  beat_index?: number
}

export interface UseStoryStreamReturn {
  events: StoryEvent[]
  isConnected: boolean
  currentBeat: (StoryEvent & { type: 'beat_ready' }) | null
  startStory: (taskPrompt: string, characterId?: string) => Promise<string>
  sendAction: (action: 'continue' | 'stop' | 'redirect', extra?: Record<string, unknown>) => Promise<void>
  isGenerating: boolean
  sessionId: string | null
  outline: string | null
}

export function useStoryStream(): UseStoryStreamReturn {
  const [events, setEvents] = useState<StoryEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [currentBeat, setCurrentBeat] = useState<UseStoryStreamReturn['currentBeat']>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [outline, setOutline] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Subscribe to Realtime when sessionId changes
  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`story:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'story_events',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as {
            event_type: string
            event_data: Record<string, unknown>
            beat_index: number
          }
          const evt: StoryEvent = {
            type: row.event_type,
            data: row.event_data,
            beat_index: row.beat_index,
          }
          setEvents((prev) => [...prev, evt])
          if (evt.type === 'beat_ready') {
            setCurrentBeat(evt as StoryEvent & { type: 'beat_ready' })
          }
        },
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
      channelRef.current = null
    }
  }, [sessionId])

  const startStory = useCallback(async (taskPrompt: string, characterId = 'walter'): Promise<string> => {
    setEvents([])
    setCurrentBeat(null)
    setOutline(null)
    setIsGenerating(true)

    try {
      const res = await fetch('/api/story/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_prompt: taskPrompt, active_character_id: characterId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(err.error || 'Story start failed')
      }
      const data = await res.json()
      setSessionId(data.session_id)
      setOutline(data.outline)
      return data.session_id
    } finally {
      setIsGenerating(false)
    }
  }, [])

  const sendAction = useCallback(async (action: 'continue' | 'stop' | 'redirect', extra?: Record<string, unknown>) => {
    if (!sessionId) throw new Error('No active session')
    setIsGenerating(true)

    try {
      const res = await fetch('/api/story/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, action, ...extra }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(err.error || 'Story next failed')
      }
      // Events arrive via Realtime subscription
    } finally {
      setIsGenerating(false)
    }
  }, [sessionId])

  return {
    events,
    isConnected,
    currentBeat,
    startStory,
    sendAction,
    isGenerating,
    sessionId,
    outline,
  }
}
