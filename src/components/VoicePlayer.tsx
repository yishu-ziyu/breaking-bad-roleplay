/* react-hooks/refs false-positives on createElement + click handlers that only
 * touch refs at click time (needed so node:test can render without JSX transform). */
/* eslint-disable react-hooks/refs */
import { createElement, useEffect, useRef, useState } from 'react'
import type { CharacterId } from '../roleProfiles'
import { hasClonedVoice } from '../lib/voiceCasting'
import { authHeaders } from '../lib/authHeaders'
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

function PlayGlyph() {
  return createElement(
    'svg',
    {
      className: 'voice-player__glyph',
      viewBox: '0 0 16 16',
      width: 12,
      height: 12,
      'aria-hidden': true,
      focusable: false,
    },
    createElement('path', {
      // Optical center: slightly right of geometric center so the triangle does not look left-heavy.
      d: 'M5.2 2.6v10.8L13.4 8z',
      fill: 'currentColor',
    }),
  )
}

function PauseGlyph() {
  return createElement(
    'svg',
    {
      className: 'voice-player__glyph',
      viewBox: '0 0 16 16',
      width: 12,
      height: 12,
      'aria-hidden': true,
      focusable: false,
    },
    createElement('rect', { x: 3.5, y: 2.5, width: 3.2, height: 11, rx: 0.6, fill: 'currentColor' }),
    createElement('rect', { x: 9.3, y: 2.5, width: 3.2, height: 11, rx: 0.6, fill: 'currentColor' }),
  )
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

  const fallbackLabel = label || (language === 'zh' ? '播放' : 'Play')

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
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          text,
          characterId,
          language,
          connectionSessionId: connectionSessionId || undefined,
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        const msg =
          typeof detail.detail === 'object' && detail.detail?.message
            ? detail.detail.message
            : detail.detail || `TTS failed (${res.status})`
        throw new Error(msg)
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
    state === 'speaking' ? createElement(PauseGlyph) : createElement(PlayGlyph),
    createElement('span', { className: 'voice-player__label' }, fallbackLabel),
  )
}
