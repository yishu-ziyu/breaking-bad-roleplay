/**
 * ColdOpenLanding — full-screen cinematic cold open.
 *
 * Flow: crisis beat → primary/tertiary choice → compact cast strip → onStart.
 * Parent owns wiring into Story mode; this file stays free of App.tsx internals.
 */
/* eslint-disable react-refresh/only-export-components -- cold-open also exports prompt map for App */


import { useCallback, useId, useState, type CSSProperties } from 'react'
import { Silhouette } from '../lib/silhouette'

import type { ColdOpenChoiceId, ColdOpenLanguage, KnowledgeTrack } from './coldOpenCopy'
import {
  BRIEF_COPY,
  COLD_OPEN_CAST,
  COLD_OPEN_PROMPTS,
  CHOICE_COPY,
  CRISIS_COPY,
  ENTERING_COPY,
  UI_COPY,
} from './coldOpenCopy'

/* Re-exports keep App.tsx import paths stable after the copy split. */
export type { ColdOpenChoiceId, ColdOpenLanguage, KnowledgeTrack }
export { COLD_OPEN_PROMPTS }

export type ColdOpenStartPayload = {
  choiceId: ColdOpenChoiceId
  characterId: string
  storyPrompt: string
}

export type ColdOpenLandingProps = {
  language: ColdOpenLanguage
  /** Chosen at the brief screen; null until then. Drives copy density everywhere. */
  knowledgeTrack: KnowledgeTrack | null
  onKnowledgePick: (track: KnowledgeTrack) => void
  onStart: (payload: ColdOpenStartPayload) => void
  onOpenSettings?: () => void
  /** Optional zh/en toggle; parent persists via usePersistedState. */
  onLanguageChange?: (lang: ColdOpenLanguage) => void
  /** True while parent is starting a story session (blocks double-submit). */
  starting?: boolean
  /** Connection / start failure message (connection-gate). Shown as alert banner. */
  error?: string | null
}

const PRIMARY_CHOICES: ColdOpenChoiceId[] = ['find_jesse', 'clean_scene', 'call_saul']

/**
 * Perspective note appended to the story seed when the player casts against the
 * default cook role. Crisis copy speaks to the cook who stayed; without this
 * the seed contradicts an identity who bolted (Jesse) or was never in the RV.
 */
const IDENTITY_NOTE: Record<string, Record<ColdOpenLanguage, string>> = {
  walter: { zh: '', en: '' },
  jesse: {
    zh: '（注意：玩家扮演的就是杰西——冲进黑地的那个人。这一夜从他狂奔的视角展开。）',
    en: ' (Note: the player IS Jesse — the one who bolted. The night unfolds from his side of the run.)',
  },
  saul: {
    zh: '（注意：玩家扮演的是索尔·古德曼——深夜被这摊事拽进局里的律师。）',
    en: ' (Note: the player is Saul Goodman — the lawyer this mess drags in at night.)',
  },
  mike: {
    zh: '（注意：玩家扮演的是迈克——被卷进这一夜的专业人士。）',
    en: ' (Note: the player is Mike — the professional pulled into this night.)',
  },
}

type Phase = 'crisis' | 'casting'

export function ColdOpenLanding({
  language,
  knowledgeTrack,
  onKnowledgePick,
  onStart,
  onOpenSettings,
  onLanguageChange,
  starting = false,
  error = null,
}: ColdOpenLandingProps) {
  const [phase, setPhase] = useState<Phase>('crisis')
  const [selectedChoice, setSelectedChoice] = useState<ColdOpenChoiceId | null>(null)
  const titleId = useId()
  const castTitleId = useId()
  const zh = language === 'zh'
  const ui = UI_COPY[language]
  const track: KnowledgeTrack = knowledgeTrack ?? 'fresh'
  const crisis = CRISIS_COPY[language][track]
  /** When player already chose Call Saul, de-emphasize casting as Saul (still selectable). */
  const deemphasizeSaul = phase === 'casting' && selectedChoice === 'call_saul'
  const castFocusIndex = deemphasizeSaul
    ? Math.max(0, COLD_OPEN_CAST.findIndex((m) => m.id !== 'saul'))
    : 0

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
      const note = IDENTITY_NOTE[characterId]?.[language] ?? ''
      onStart({
        choiceId: selectedChoice,
        characterId,
        storyPrompt: COLD_OPEN_PROMPTS[selectedChoice][language][track] + note,
      })
    },
    [language, onStart, selectedChoice, starting, track],
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

      {error ? (
        <div className="cold-open__error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="cold-open__content">
        {!knowledgeTrack ? (
          /* Brief (phase 0): value line + knowledge question. One tap either way. */
          <div className="cold-open__stage cold-open__stage--brief" key="brief">
            <h2 className="cold-open__brief-title" id={titleId}>
              {BRIEF_COPY[language].title}
            </h2>
            <p className="cold-open__brief-sub">{BRIEF_COPY[language].sub}</p>
            <div className="cold-open__divider" aria-hidden="true" />
            <p className="cold-open__brief-q">{BRIEF_COPY[language].question}</p>
            <div className="cold-open__brief-answers" role="group" aria-label={BRIEF_COPY[language].question}>
              <button
                type="button"
                className="cold-open__choice"
                onClick={() => onKnowledgePick('fan')}
                autoFocus
                disabled={starting}
              >
                <span className="cold-open__choice-body">
                  <span className="cold-open__choice-label">{BRIEF_COPY[language].fan}</span>
                </span>
                <span className="cold-open__choice-arrow" aria-hidden="true">→</span>
              </button>
              <button
                type="button"
                className="cold-open__choice"
                onClick={() => onKnowledgePick('fresh')}
                disabled={starting}
              >
                <span className="cold-open__choice-body">
                  <span className="cold-open__choice-label">{BRIEF_COPY[language].fresh}</span>
                </span>
                <span className="cold-open__choice-arrow" aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        ) : phase === 'crisis' ? (
          <div className="cold-open__stage cold-open__stage--crisis" key="crisis">
            <p className="cold-open__stamp" id={titleId}>
              {crisis.stamp}
            </p>
            <p className="cold-open__establish">{crisis.establish}</p>
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
                <span className="cold-open__chosen-prefix">{ui.chosenPrefix}</span>
                {' '}
                <span className="cold-open__chosen-label">
                  {CHOICE_COPY[selectedChoice][language].label}
                </span>
              </p>
            )}

            <h2 className="cold-open__cast-title" id={castTitleId}>
              {ui.castTitle}
            </h2>
            <p className="cold-open__cast-hint">{ui.castHint}</p>

            {starting && (
              <div className="cold-open__entering" role="status" aria-live="polite">
                <p className="cold-open__entering-diegetic">
                  {ENTERING_COPY[language].diegetic}
                </p>
                <p className="cold-open__entering-secondary">
                  {ENTERING_COPY[language].secondary}
                </p>
              </div>
            )}

            <div
              className="cold-open__cast"
              role="group"
              aria-label={ui.castTitle}
            >
              {COLD_OPEN_CAST.map((member, index) => {
                const displayName = member.name[language]
                const isSaulDeemphasized = deemphasizeSaul && member.id === 'saul'
                const isRecommended = deemphasizeSaul && member.id !== 'saul'
                return (
                  <button
                    key={member.id}
                    type="button"
                    className={[
                      'cold-open__cast-member',
                      isSaulDeemphasized ? 'cold-open__cast-member--deemphasized' : '',
                      isRecommended ? 'cold-open__cast-member--recommended' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ '--cast-accent': member.accent } as CSSProperties}
                    onClick={() => handleCast(member.id)}
                    autoFocus={index === castFocusIndex}
                    disabled={starting}
                    aria-label={
                      isSaulDeemphasized
                        ? `${ui.continueAs} ${displayName} (${ui.saulAlready})`
                        : isRecommended
                          ? `${ui.continueAs} ${displayName} (${ui.recommended})`
                          : `${ui.continueAs} ${displayName}`
                    }
                  >
                    {isRecommended && (
                      <span className="cold-open__cast-badge" aria-hidden="true">
                        {ui.recommended}
                      </span>
                    )}
                    {isSaulDeemphasized && (
                      <span className="cold-open__cast-hint-soft" aria-hidden="true">
                        {ui.saulAlready}
                      </span>
                    )}
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
