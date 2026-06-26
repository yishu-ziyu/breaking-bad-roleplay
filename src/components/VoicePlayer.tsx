import { useEffect, useRef, useState } from 'react'
import type { CharacterId } from '../roleProfiles'

export function relationSlug(relation: string): string {
  return relation.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function buildUrls(characterId: CharacterId, relation?: string): string[] {
  const base = `/voice/${characterId}`
  if (relation) {
    return [`${base}-${relationSlug(relation)}.mp3`, `${base}.mp3`]
  }
  return [`${base}.mp3`]
}

export interface VoicePlayerProps {
  characterId: CharacterId
  relation?: string
  label?: string
}

export function VoicePlayer({ characterId, relation, label }: VoicePlayerProps) {
  const [exists, setExists] = useState<boolean | null>(null)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urls = buildUrls(characterId, relation)

  useEffect(() => {
    let cancelled = false
    setExists(null)
    ;(async () => {
      for (const url of urls) {
        try {
          const res = await fetch(url, { method: 'HEAD' })
          if (!cancelled && res.ok) {
            setExists(true)
            return
          }
        } catch {
          // ignore
        }
      }
      if (!cancelled) setExists(false)
    })()
    return () => { cancelled = true }
  }, [urls.join('|')])

  if (exists === false) {
    return (
      <button type="button" className="voice-player voice-player--disabled" disabled>
        {label || 'Voice sample unavailable'}
      </button>
    )
  }

  if (exists !== true) {
    return (
      <button type="button" className="voice-player voice-player--disabled" disabled>
        {label || 'Voice sample'}
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        className={`voice-player ${playing ? 'voice-player--playing' : ''}`}
        onClick={() => {
          const audio = audioRef.current
          if (!audio) return
          if (audio.paused) {
            audio.play().catch(() => {})
          } else {
            audio.pause()
          }
        }}
        aria-label={label || 'Play voice sample'}
      >
        {playing ? '⏸' : '▶'} {label || 'Voice'}
      </button>
      <audio
        ref={audioRef}
        src={urls[0]}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </>
  )
}
