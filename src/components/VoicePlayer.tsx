import { createElement, useEffect, useState } from 'react'
import type { CharacterId } from '../roleProfiles'
import { createPlayHandler, handleVoiceToggle, type PlayState, type SpeechSynthLike } from '../lib/voicePlayerHelpers'

export interface VoicePlayerProps {
  text: string
  characterId: CharacterId
  language: 'en' | 'zh'
  label?: string
}

function getSpeechSynthesis(): SpeechSynthLike | undefined {
  if (typeof globalThis === 'undefined') return undefined
  const g = globalThis as { speechSynthesis?: SpeechSynthLike }
  return g.speechSynthesis
}

export function VoicePlayer({ text, characterId, language, label }: VoicePlayerProps) {
  const [state, setState] = useState<PlayState>('idle')
  const synth = getSpeechSynthesis()

  // Cancel any in-progress speech when the component unmounts.
  // Placed before the early return so the hook always runs (Rules of Hooks).
  // Prevents setState-on-unmounted warnings and stops audio continuing.
  useEffect(() => {
    return () => {
      synth?.cancel?.()
    }
  }, [synth])

  if (!synth) {
    return createElement(
      'button',
      {
        type: 'button',
        className: 'voice-player voice-player--disabled',
        disabled: true,
      },
      label || 'Voice sample unavailable'
    )
  }

  const play = createPlayHandler(text, characterId, language, synth, setState)

  const handleClick = () => handleVoiceToggle(state, synth, play, setState)

  return createElement(
    'button',
    {
      type: 'button',
      className: `voice-player ${state === 'speaking' ? 'voice-player--playing' : ''}`,
      onClick: handleClick,
      'aria-label': label || 'Play voice sample',
    },
    `${state === 'speaking' ? '⏸' : '▶'} ${label || 'Voice'}`
  )
}
