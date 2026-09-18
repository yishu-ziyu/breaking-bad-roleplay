/**
 * PlayModeBar — in-product switch between 剧情 / 单聊 / 群聊.
 *
 * T10 (2026-09-18): while Story is closed to visitors, 剧情 must not switch the
 * surface. The click shows the same "剧情正在开发中" notice as the cold-open card
 * instead. 单聊 / 群聊 are unaffected.
 */

import { useState } from 'react'
import { playModeBlocked, storyComingSoonCopy } from '../lib/storyAvailability'
import { StoryComingSoonNotice } from './StoryComingSoonNotice'

export type PlayMode = 'story' | 'direct' | 'crew'

export type PlayModeBarProps = {
  value: PlayMode
  language: 'zh' | 'en'
  onChange: (mode: PlayMode) => void
  /**
   * Story gate (T10). Defaults to closed: a caller that forgets the switch must
   * not let visitors into Story. Authors pass the resolved authoring switch.
   */
  storyOpen?: boolean
}

const COPY: Record<'zh' | 'en', Record<PlayMode | 'label', string>> = {
  zh: { label: '玩法', story: '剧情', direct: '单聊', crew: '群聊' },
  en: { label: 'Play', story: 'Story', direct: 'Direct', crew: 'Crew' },
}

const MODES: PlayMode[] = ['story', 'direct', 'crew']

export function PlayModeBar({ value, language, onChange, storyOpen = false }: PlayModeBarProps) {
  const t = COPY[language]
  const soon = storyComingSoonCopy(language)
  /** Visitor pressed the closed 剧情 button — explain instead of switching. */
  const [storyClosedNotice, setStoryClosedNotice] = useState(false)

  const handleClick = (mode: PlayMode) => {
    if (playModeBlocked(mode, storyOpen)) {
      setStoryClosedNotice(true)
      return
    }
    onChange(mode)
  }

  return (
    <div className="play-mode-bar__stack">
      <div className="play-mode-bar" role="group" aria-label={t.label}>
        {MODES.map((mode) => {
          const blocked = playModeBlocked(mode, storyOpen)
          return (
            <button
              key={mode}
              type="button"
              className={value === mode ? 'is-active' : undefined}
              aria-pressed={value === mode}
              aria-disabled={blocked || undefined}
              onClick={() => handleClick(mode)}
            >
              {t[mode]}
              {blocked ? (
                <span className="play-mode-bar__soon" aria-hidden="true">
                  {soon.badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      {storyClosedNotice && (
        <StoryComingSoonNotice language={language} className="play-mode-bar__notice" />
      )}
    </div>
  )
}

export default PlayModeBar
