export type PlayMode = 'story' | 'direct' | 'crew'

export type PlayModeBarProps = {
  value: PlayMode
  language: 'zh' | 'en'
  onChange: (mode: PlayMode) => void
}

const COPY: Record<'zh' | 'en', Record<PlayMode | 'label', string>> = {
  zh: { label: '玩法', story: '剧情', direct: '单聊', crew: '群聊' },
  en: { label: 'Play', story: 'Story', direct: 'Direct', crew: 'Crew' },
}

const MODES: PlayMode[] = ['story', 'direct', 'crew']

export function PlayModeBar({ value, language, onChange }: PlayModeBarProps) {
  const t = COPY[language]
  return (
    <div className="play-mode-bar" role="group" aria-label={t.label}>
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className={value === mode ? 'is-active' : undefined}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          {t[mode]}
        </button>
      ))}
    </div>
  )
}

export default PlayModeBar
