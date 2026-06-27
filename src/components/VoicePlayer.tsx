import { useEffect, useMemo, useRef, useState } from 'react'
import type { CharacterId } from '../roleProfiles'
import { buildUrls, relationSlug } from '../lib/voiceUrls'

export { buildUrls, relationSlug }

export interface VoicePlayerProps {
  characterId: CharacterId
  relation?: string
  label?: string
}

export function VoicePlayer({ characterId, relation, label }: VoicePlayerProps) {
  const [exists, setExists] = useState<boolean | null>(null)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urls = useMemo(() => buildUrls(characterId, relation), [characterId, relation])

  useEffect(() => {
    let cancelled = false
    setExists(null)
    async function probe() {
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
    }
    probe()
    return () => { cancelled = true }
  }, [urls])

  if (exists !== true) {
    return (
      <button type="button" className="voice-player voice-player--disabled" disabled>
        {label || (exists === false ? 'Voice sample unavailable' : 'Voice sample')}
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
