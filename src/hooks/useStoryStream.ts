/* =================================================================
   ABQ Roleplay Lab — useStoryStream (local replay)
   Single API call returns all beats; frontend replays locally.
   No database needed.
   ================================================================= */

import { useCallback, useRef, useState } from 'react'

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
  beatIndex: number
  totalBeats: number
}

interface Beat {
  scene: string
  events: StoryEvent[]
  director_note: string
}

export function useStoryStream(): UseStoryStreamReturn {
  const [events, setEvents] = useState<StoryEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [currentBeat, setCurrentBeat] = useState<UseStoryStreamReturn['currentBeat']>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [outline, setOutline] = useState<string | null>(null)
  const [beatIndex, setBeatIndex] = useState(0)
  const [totalBeats, setTotalBeats] = useState(0)

  const beatsRef = useRef<Beat[]>([])

  const startStory = useCallback(async (taskPrompt: string, characterId = 'walter'): Promise<string> => {
    setEvents([])
    setCurrentBeat(null)
    setOutline(null)
    setBeatIndex(0)
    setTotalBeats(0)
    beatsRef.current = []
    setIsGenerating(true)
    setIsConnected(false)

    try {
      const res = await fetch('/api/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_prompt: taskPrompt, active_character_id: characterId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(err.error || 'Story start failed')
      }
      const data = await res.json()

      const id = crypto.randomUUID()
      setSessionId(id)
      setOutline(Array.isArray(data.outline) ? data.outline.join('\n') : (data.outline || ''))

      // Normalize and store beats locally
      const rawBeats = (data.beats || []) as Array<Record<string, unknown>>
      const beats: Beat[] = rawBeats.map((b) => {
        const scene = typeof b.scene === 'string' ? b.scene : ''
        const rawEvents = Array.isArray(b.events) ? b.events : []
        const directorNote = typeof b.director_note === 'string' ? b.director_note : ''
        const events: StoryEvent[] = rawEvents.map((e) => {
          const evt = e as Record<string, unknown>
          return {
            type: typeof evt.type === 'string' ? evt.type : 'unknown',
            data: (evt.data as Record<string, unknown>) || {},
            beat_index: beatsRef.current.length,
          }
        })
        return { scene, events, director_note: directorNote }
      })

      // If no structured beats, create one from outline
      if (beats.length === 0 && data.outline) {
        beats.push({
          scene: data.outline.split('\n')[0] || 'The story begins',
          events: [{ type: 'scene_change', data: { description: data.outline }, beat_index: 0 }],
          director_note: '',
        })
      }

      beatsRef.current = beats
      setTotalBeats(beats.length)

      // Play first beat immediately
      if (beats.length > 0) {
        setEvents(beats[0].events)
        setBeatIndex(0)
        setCurrentBeat({ type: 'beat_ready', data: { scene: beats[0].scene, director_note: beats[0].director_note }, beat_index: 0 })
      }

      setIsConnected(true)
      return id
    } finally {
      setIsGenerating(false)
    }
  }, [])

  const sendAction = useCallback(async (action: 'continue' | 'stop' | 'redirect') => {
    if (action === 'stop') {
      setEvents([])
      setCurrentBeat(null)
      setSessionId(null)
      setOutline(null)
      setBeatIndex(0)
      setTotalBeats(0)
      beatsRef.current = []
      setIsConnected(false)
      return
    }

    if (action === 'continue') {
      const nextIndex = beatIndex + 1
      if (nextIndex >= beatsRef.current.length) {
        setEvents((prev) => [...prev, { type: 'complete', data: { message: 'All beats rendered.' }, beat_index: nextIndex }])
        setCurrentBeat(null)
        return
      }

      setIsGenerating(true)
      // Simulate LLM latency for UX
      await new Promise((r) => setTimeout(r, 600))

      const beat = beatsRef.current[nextIndex]
      setBeatIndex(nextIndex)
      setEvents((prev) => [...prev, ...beat.events])
      setCurrentBeat({ type: 'beat_ready', data: { scene: beat.scene, director_note: beat.director_note }, beat_index: nextIndex })
      setIsGenerating(false)
    }
  }, [beatIndex])

  return {
    events,
    isConnected,
    currentBeat,
    startStory,
    sendAction,
    isGenerating,
    sessionId,
    outline,
    beatIndex,
    totalBeats,
  }
}
