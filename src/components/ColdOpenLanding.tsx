/**
 * ColdOpenLanding — full-screen cinematic cold open.
 *
 * Flow: crisis beat → primary/tertiary choice → compact cast strip → onStart.
 * Parent owns wiring into Story mode; this file stays free of App.tsx internals.
 */
/* eslint-disable react-refresh/only-export-components -- cold-open also exports prompt map for App */


import { useCallback, useId, useState, type CSSProperties } from 'react'
import { Silhouette } from '../lib/silhouette'
import type { CharacterId } from '../roleProfiles'

export type ColdOpenLanguage = 'zh' | 'en'

export type ColdOpenChoiceId = 'find_jesse' | 'clean_scene' | 'call_saul' | 'free'

export type ColdOpenStartPayload = {
  choiceId: ColdOpenChoiceId
  characterId: string
  storyPrompt: string
}

export type ColdOpenLandingProps = {
  language: ColdOpenLanguage
  onStart: (payload: ColdOpenStartPayload) => void
  onOpenSettings?: () => void
  /** Optional zh/en toggle; parent persists via usePersistedState. */
  onLanguageChange?: (lang: ColdOpenLanguage) => void
  /** True while parent is starting a story session (blocks double-submit). */
  starting?: boolean
}

/** Story seed text per cold-open choice. Parent may also import this map. */
export const COLD_OPEN_PROMPTS: Record<
  ColdOpenChoiceId,
  Record<ColdOpenLanguage, string>
> = {
  find_jesse: {
    en: 'New Mexico desert, 2:13 a.m. The RV back door hangs open. Jesse is gone and half the cash is missing. You step into the dark to find him before anyone else does — every minute he is missing makes this worse.',
    zh: '新墨西哥沙漠，凌晨 2:13。房车后门敞着。杰西不见了，桌上的钱少了一半。你走进夜色里找他，必须赶在任何人之前——他每消失一分钟，局面就更糟一分。',
  },
  clean_scene: {
    en: 'New Mexico desert, 2:13 a.m. The RV is a crime scene waiting to happen. Jesse is gone, half the cash is missing, and the desert keeps no secrets. Wipe every print, bury every loose end, and leave nothing the morning light can use against you.',
    zh: '新墨西哥沙漠，凌晨 2:13。房车随时会变成犯罪现场。杰西不见了，钱少了一半，沙漠不帮任何人保密。擦掉指纹，处理掉所有破绽，别给晨光留下任何把柄。',
  },
  call_saul: {
    en: 'New Mexico desert, 2:13 a.m. Jesse is gone, half the cash is missing, and the only professional left on speed-dial is Saul Goodman. You call him into this mess — he will want cash, leverage, and a story that holds up under pressure.',
    zh: '新墨西哥沙漠，凌晨 2:13。杰西不见了，钱少了一半，通讯录里唯一还能用的专业人士是索尔·古德曼。你把他拖进这摊浑水——他会要钱、要筹码、要一个扛得住压力的说法。',
  },
  free: {
    en: 'New Mexico desert, 2:13 a.m. The RV back door is open. Jesse is gone. Half the cash is missing. You decide what happens next — no script, only the night and whatever you are willing to risk.',
    zh: '新墨西哥沙漠，凌晨 2:13。房车后门开着。杰西不见了。桌上的钱少了一半。接下来怎么做由你决定——没有剧本，只有这一夜，以及你愿意押上的一切。',
  },
}

const CRISIS_COPY: Record<ColdOpenLanguage, { stamp: string; body: string }> = {
  en: {
    stamp: 'New Mexico · 2:13 a.m.',
    body: 'The RV back door is open. Jesse is gone. Half the cash is missing.',
  },
  zh: {
    stamp: '新墨西哥 · 凌晨 2:13',
    body: '房车后门开着。杰西不见了。桌上的钱少了一半。',
  },
}

const CHOICE_COPY: Record<
  ColdOpenChoiceId,
  Record<ColdOpenLanguage, { label: string; hint: string }>
> = {
  find_jesse: {
    en: { label: 'Find Jesse', hint: 'Track him before the desert does.' },
    zh: { label: '寻找杰西', hint: '在沙漠吞掉他之前找到他。' },
  },
  clean_scene: {
    en: { label: 'Clean the scene', hint: 'Erase what morning light would see.' },
    zh: { label: '清理现场', hint: '别给晨光留下任何痕迹。' },
  },
  call_saul: {
    en: { label: 'Call Saul', hint: 'Buy a lawyer. Buy time.' },
    zh: { label: '打给索尔', hint: '买一个律师。买一点时间。' },
  },
  free: {
    en: { label: 'Decide myself…', hint: 'No prescribed move.' },
    zh: { label: '自己决定…', hint: '没有规定动作。' },
  },
}

const UI_COPY: Record<
  ColdOpenLanguage,
  {
    brand: string
    castTitle: string
    castHint: string
    back: string
    settings: string
    continueAs: string
    entering: string
  }
> = {
  en: {
    brand: 'Cold Open',
    castTitle: 'You enter as who?',
    castHint: 'Pick a face for this night.',
    back: 'Back to choices',
    settings: 'Settings',
    continueAs: 'Enter as',
    entering: 'Entering…',
  },
  zh: {
    brand: '冷开场',
    castTitle: '你以谁的身份进入？',
    castHint: '为这一夜选一张脸。',
    back: '返回选择',
    settings: '设置',
    continueAs: '进入角色',
    entering: '进入中…',
  },
}

type CastMember = {
  id: CharacterId
  name: Record<ColdOpenLanguage, string>
  accent: string
}

/** Compact cast for this cold open — not the full 8-card grid. */
const COLD_OPEN_CAST: CastMember[] = [
  { id: 'walter', name: { en: 'Walter', zh: '沃尔特' }, accent: '#d7e36f' },
  { id: 'jesse', name: { en: 'Jesse', zh: '杰西' }, accent: '#93d7ff' },
  { id: 'saul', name: { en: 'Saul', zh: '索尔' }, accent: '#f7ce46' },
  { id: 'mike', name: { en: 'Mike', zh: '迈克' }, accent: '#b9c0a5' },
]

const PRIMARY_CHOICES: ColdOpenChoiceId[] = ['find_jesse', 'clean_scene', 'call_saul']

type Phase = 'crisis' | 'casting'

export function ColdOpenLanding({
  language,
  onStart,
  onOpenSettings,
  onLanguageChange,
  starting = false,
}: ColdOpenLandingProps) {
  const [phase, setPhase] = useState<Phase>('crisis')
  const [selectedChoice, setSelectedChoice] = useState<ColdOpenChoiceId | null>(null)
  const titleId = useId()
  const castTitleId = useId()
  const zh = language === 'zh'
  const ui = UI_COPY[language]
  const crisis = CRISIS_COPY[language]

  const handleChoice = useCallback((choiceId: ColdOpenChoiceId) => {
    if (starting) return
    setSelectedChoice(choiceId)
    setPhase('casting')
  }, [starting])

  const handleBack = useCallback(() => {
    if (starting) return
    setPhase('crisis')
    setSelectedChoice(null)
  }, [starting])

  const handleCast = useCallback(
    (characterId: string) => {
      if (starting || !selectedChoice) return
      onStart({
        choiceId: selectedChoice,
        characterId,
        storyPrompt: COLD_OPEN_PROMPTS[selectedChoice][language],
      })
    },
    [language, onStart, selectedChoice, starting],
  )

  return (
    <div
      className="cold-open"
      role="dialog"
      aria-modal="true"
      aria-busy={starting || undefined}
      aria-labelledby={phase === 'crisis' ? titleId : castTitleId}
    >
      <div className="cold-open__bg" aria-hidden="true" />
      <div className="cold-open__vignette" aria-hidden="true" />
      <div className="cold-open__grain" aria-hidden="true" />

      {(onLanguageChange || onOpenSettings) && (
        <div className="cold-open__toolbar">
          {onLanguageChange && (
            <div
              className="cold-open__lang"
              role="group"
              aria-label={zh ? '语言' : 'Language'}
            >
              <button
                type="button"
                className={language === 'zh' ? 'is-active' : undefined}
                onClick={() => onLanguageChange('zh')}
                aria-pressed={language === 'zh'}
                disabled={starting}
              >
                中文
              </button>
              <button
                type="button"
                className={language === 'en' ? 'is-active' : undefined}
                onClick={() => onLanguageChange('en')}
                aria-pressed={language === 'en'}
                disabled={starting}
              >
                EN
              </button>
            </div>
          )}
          {onOpenSettings && (
            <button
              type="button"
              className="cold-open__settings"
              onClick={onOpenSettings}
              aria-label={ui.settings}
              disabled={starting}
            >
              {ui.settings}
            </button>
          )}
        </div>
      )}

      <div className="cold-open__content">
        {phase === 'crisis' ? (
          <div className="cold-open__stage cold-open__stage--crisis" key="crisis">
            <p className="cold-open__brand">{ui.brand}</p>
            <p className="cold-open__stamp" id={titleId}>
              {crisis.stamp}
            </p>
            <p className="cold-open__crisis">{crisis.body}</p>
            <div className="cold-open__divider" aria-hidden="true" />

            <div className="cold-open__choices" role="group" aria-label={zh ? '行动选择' : 'What do you do?'}>
              {PRIMARY_CHOICES.map((id, index) => {
                const copy = CHOICE_COPY[id][language]
                return (
                  <button
                    key={id}
                    type="button"
                    className="cold-open__choice"
                    onClick={() => handleChoice(id)}
                    autoFocus={index === 0}
                    disabled={starting}
                  >
                    <span className="cold-open__choice-index" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="cold-open__choice-body">
                      <span className="cold-open__choice-label">{copy.label}</span>
                      <span className="cold-open__choice-hint">{copy.hint}</span>
                    </span>
                    <span className="cold-open__choice-arrow" aria-hidden="true">
                      →
                    </span>
                  </button>
                )
              })}

              <button
                type="button"
                className="cold-open__choice cold-open__choice--tertiary"
                onClick={() => handleChoice('free')}
                disabled={starting}
              >
                <span className="cold-open__choice-body">
                  <span className="cold-open__choice-label">
                    {CHOICE_COPY.free[language].label}
                  </span>
                  <span className="cold-open__choice-hint">
                    {CHOICE_COPY.free[language].hint}
                  </span>
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="cold-open__stage cold-open__stage--cast" key="cast">
            <button
              type="button"
              className="cold-open__back"
              onClick={handleBack}
              disabled={starting}
            >
              ← {ui.back}
            </button>

            {selectedChoice && (
              <p className="cold-open__chosen" aria-live="polite">
                {CHOICE_COPY[selectedChoice][language].label}
              </p>
            )}

            <h2 className="cold-open__cast-title" id={castTitleId}>
              {ui.castTitle}
            </h2>
            <p className="cold-open__cast-hint">{ui.castHint}</p>

            {starting && (
              <p className="cold-open__entering" role="status" aria-live="polite">
                {ui.entering}
              </p>
            )}

            <div
              className="cold-open__cast"
              role="group"
              aria-label={ui.castTitle}
            >
              {COLD_OPEN_CAST.map((member, index) => {
                const displayName = member.name[language]
                return (
                  <button
                    key={member.id}
                    type="button"
                    className="cold-open__cast-member"
                    style={{ '--cast-accent': member.accent } as CSSProperties}
                    onClick={() => handleCast(member.id)}
                    autoFocus={index === 0}
                    disabled={starting}
                    aria-label={`${ui.continueAs} ${displayName}`}
                  >
                    <span className="cold-open__cast-avatar">
                      <Silhouette
                        characterId={member.id}
                        name={displayName}
                        size={56}
                      />
                    </span>
                    <span className="cold-open__cast-name">{displayName}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ColdOpenLanding
