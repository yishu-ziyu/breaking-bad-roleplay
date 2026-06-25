/* =================================================================
   ABQ Roleplay Lab — useStoryStream (outline-confirm + local replay)
   Phase 1: API returns all data, frontend shows outline only
   Phase 2: User confirms → beats replay one at a time
   ================================================================= */

import { useCallback, useRef, useState } from 'react'

export interface StoryEvent {
  type: string
  data: Record<string, unknown>
  beat_index?: number
}

export interface UseStoryStreamReturn {
  events: StoryEvent[]
  outline: string | null
  beatIndex: number
  totalBeats: number
  confirmed: boolean
  isGenerating: boolean
  sessionId: string | null
  startStory: (taskPrompt: string, characterId?: string, llmProvider?: string) => Promise<void>
  confirmStory: () => void
  sendAction: (action: 'continue' | 'stop') => void
}

interface Beat {
  scene: string
  events: StoryEvent[]
  director_note: string
}

export function useStoryStream(): UseStoryStreamReturn {
  const [events, setEvents] = useState<StoryEvent[]>([])
  const [outline, setOutline] = useState<string | null>(null)
  const [beatIndex, setBeatIndex] = useState(0)
  const [totalBeats, setTotalBeats] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const beatsRef = useRef<Beat[]>([])

  const startStory = useCallback(async (taskPrompt: string, characterId = 'walter', llmProvider = 'agnes'): Promise<void> => {
    setEvents([])
    setOutline(null)
    setBeatIndex(0)
    setTotalBeats(0)
    setConfirmed(false)
    beatsRef.current = []
    setIsGenerating(true)
    setSessionId(null)

    try {
      const res = await fetch('/api/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_prompt: taskPrompt, active_character_id: characterId, llmProvider }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(err.error || 'Story start failed')
      }
      const data = await res.json()

      setSessionId(crypto.randomUUID())

      // Format outline — only scene titles, NO details
      const outlineRaw = data.outline
      if (Array.isArray(outlineRaw)) {
        setOutline(outlineRaw.join('\n'))
      } else if (typeof outlineRaw === 'string') {
        setOutline(outlineRaw)
      }

      // Store all beats locally (NOT shown yet)
      const rawBeats = (data.beats || []) as Array<Record<string, unknown>>
      const beats: Beat[] = rawBeats.map((b) => {
        const scene = typeof b.scene === 'string' ? b.scene : ''
        const rawEvents = Array.isArray(b.events) ? b.events : []
        const events: StoryEvent[] = rawEvents.map((e) => {
          const evt = e as Record<string, unknown>
          return {
            type: typeof evt.type === 'string' ? evt.type : 'unknown',
            data: (evt.data as Record<string, unknown>) || {},
            beat_index: beatsRef.current.length,
          }
        })
        return { scene, events, director_note: typeof b.director_note === 'string' ? b.director_note : '' }
      })

      // Fallback: create one beat from outline if no structured beats
      if (beats.length === 0 && outlineRaw) {
        const outlineText = Array.isArray(outlineRaw) ? outlineRaw.join('\n') : outlineRaw
        beats.push({
          scene: outlineText.split('\n')[0] || 'The story begins',
          events: [{ type: 'scene_change', data: { description: outlineText }, beat_index: 0 }],
          director_note: '',
        })
      }

      beatsRef.current = beats
      setTotalBeats(beats.length)
    } catch (e) {
      throw e
    } finally {
      setIsGenerating(false)
    }
  }, [])

  const confirmStory = useCallback(() => {
    setConfirmed(true)
    const beats = beatsRef.current
    if (beats.length > 0) {
      setEvents(beats[0].events)
      setBeatIndex(0)
    }
  }, [])

  const sendAction = useCallback((action: 'continue' | 'stop') => {
    if (action === 'stop') {
      setEvents([])
      setOutline(null)
      setBeatIndex(0)
      setTotalBeats(0)
      setConfirmed(false)
      beatsRef.current = []
      setSessionId(null)
      return
    }

    if (action === 'continue') {
      const nextIndex = beatIndex + 1
      if (nextIndex >= beatsRef.current.length) {
        setEvents((prev) => [...prev, { type: 'complete', data: { message: 'All beats rendered.' }, beat_index: nextIndex }])
        return
      }

      setIsGenerating(true)
      const beat = beatsRef.current[nextIndex]
      setBeatIndex(nextIndex)
      setEvents((prev) => [...prev, ...beat.events])
      setIsGenerating(false)
    }
  }, [beatIndex])

  return {
    events,
    outline,
    beatIndex,
    totalBeats,
    confirmed,
    isGenerating,
    sessionId,
    startStory,
    confirmStory,
    sendAction,
  }
}
