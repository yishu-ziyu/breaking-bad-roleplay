/* react-hooks/refs false-positives on createElement + click handlers that only
 * touch refs at click time (needed so node:test can render without JSX transform). */
/* eslint-disable react-hooks/refs */
import { createElement, useEffect, useRef, useState } from 'react'
import type { CharacterId } from '../roleProfiles'
import { hasClonedVoice } from '../lib/voiceCasting'
import {
  createPlayHandler,
  handleVoiceToggle,
  type PlayState,
  type SpeechSynthLike,
} from '../lib/voicePlayerHelpers'

export interface VoicePlayerProps {
  text: string
  characterId: CharacterId
  language: 'en' | 'zh'
  label?: string
  unavailableText?: string
  connectionSessionId?: string | null
}

function getSpeechSynthesis(): SpeechSynthLike | undefined {
  if (typeof globalThis === 'undefined') return undefined
  const g = globalThis as { speechSynthesis?: SpeechSynthLike }
  return g.speechSynthesis
}

export function VoicePlayer({
  text,
  characterId,
  language,
  label,
  unavailableText,
  connectionSessionId,
}: VoicePlayerProps) {
  const [state, setState] = useState<PlayState>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const synth = getSpeechSynthesis()
  const useClone = hasClonedVoice(characterId)
  const canPlay = useClone || Boolean(synth)

  useEffect(() => {
    return () => {
      synth?.cancel?.()
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [synth])

  const fallbackLabel = label || (language === 'zh' ? '播放语音' : 'Voice')

  if (!canPlay) {
    return createElement(
      'button',
      {
        type: 'button',
        className: 'voice-player voice-player--disabled',
        disabled: true,
      },
      unavailableText || (language === 'zh' ? '语音不可用' : 'Voice sample unavailable')
    )
  }

  const stopAll = () => {
    synth?.cancel?.()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setState('idle')
  }

  const playClone = async () => {
    setState('speaking')
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          characterId,
          language,
          connectionSessionId: connectionSessionId || undefined,
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail || `TTS failed (${res.status})`)
      }
      const blob = await res.blob()
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const url = URL.createObjectURL(blob)
      objectUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => setState('idle')
      audio.onerror = () => setState('idle')
      await audio.play()
    } catch {
      if (synth) {
        createPlayHandler(text, characterId, language, synth, setState)()
      } else {
        setState('idle')
      }
    }
  }

  const handleClick = () => {
    if (state === 'speaking') {
      stopAll()
      return
    }
    if (useClone) {
      void playClone()
      return
    }
    if (!synth) return
    handleVoiceToggle('idle', synth, createPlayHandler(text, characterId, language, synth, setState), setState)
  }

  return createElement(
    'button',
    {
      type: 'button',
      className: `voice-player ${state === 'speaking' ? 'voice-player--playing' : ''}`,
      onClick: handleClick,
      'aria-label': fallbackLabel,
    },
    `${state === 'speaking' ? '⏸' : '▶'} ${fallbackLabel}`
  )
}
