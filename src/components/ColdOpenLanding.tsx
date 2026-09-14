/**
 * ColdOpenLanding — first-run door.
 *
 * One question (have you seen the show?) starts the night. Crisis choices
 * and casting happen in the story, not as a second title screen.
 * Parent owns wiring into Story mode; this file stays free of App.tsx internals.
 */

import { useId } from 'react'
import { ElementSquare } from '../lib/ElementSquare'

import type { ColdOpenChoiceId, ColdOpenLanguage, KnowledgeTrack } from './coldOpenCopy'
import {
  BRIEF_COPY,
  COLD_OPEN_PROMPTS,
  UI_COPY,
  briefStartPayload,
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
  /** Skip Story cold-open and enter Direct chat. */
  onEnterDirect?: () => void
  /** Skip Story cold-open and enter Crew debate. */
  onEnterCrew?: () => void
}

export function ColdOpenLanding({
  language,
  onKnowledgePick,
  onStart,
  onOpenSettings,
  onLanguageChange,
  starting = false,
  error = null,
  onEnterDirect,
  onEnterCrew,
}: ColdOpenLandingProps) {
  const titleId = useId()
  const zh = language === 'zh'
  const ui = UI_COPY[language]
  const locked = starting

  const beginNight = (track: KnowledgeTrack) => {
    if (locked) return
    onKnowledgePick(track)
    onStart(briefStartPayload(track, language))
  }

  return (
    <div
      className="cold-open cold-open--brief"
      role="dialog"
      aria-modal="true"
      aria-busy={starting || undefined}
      aria-labelledby={titleId}
    >
      <div
        className="cold-open__bg"
        style={{ backgroundImage: 'url(/backgrounds/hero-desert-noir.jpg)' }}
        aria-hidden="true"
      />
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
        <div className="cold-open__wordmark" aria-hidden="true">
          <div className="cold-open__wordmark-squares">
            <ElementSquare symbol="Br" num="35" size={40} green />
            <ElementSquare symbol="Ba" num="56" size={40} />
          </div>
          <p className="cold-open__wordmark-sub">BREAKING BAD · ROLEPLAY</p>
        </div>
        <div className="cold-open__stage cold-open__stage--brief">
          <h2 className="cold-open__brief-title" id={titleId}>
            {BRIEF_COPY[language].title}
          </h2>
          <p className="cold-open__brief-sub">{BRIEF_COPY[language].sub}</p>
        </div>
      </div>

      <aside className="cold-open__door" aria-label={BRIEF_COPY[language].question}>
        <h3 className="cold-open__door-q">{BRIEF_COPY[language].question}</h3>
        <div className="cold-open__pills" role="group" aria-label={BRIEF_COPY[language].question}>
          <button
            type="button"
            className="cold-open__pill cold-open__pill--loud"
            onClick={() => beginNight('fan')}
            disabled={locked}
          >
            {BRIEF_COPY[language].fan}
          </button>
          <button
            type="button"
            className="cold-open__pill cold-open__pill--quiet"
            onClick={() => beginNight('fresh')}
            disabled={locked}
          >
            {BRIEF_COPY[language].fresh}
          </button>
        </div>
        {(onEnterDirect || onEnterCrew) && (
          <p
            className="cold-open__door-foot"
            role="group"
            aria-label={zh ? '其他玩法' : 'Other play'}
          >
            <span>{zh ? '也可以先' : 'Or just'}</span>
            {onEnterDirect && (
              <button
                type="button"
                className="cold-open__door-link"
                onClick={onEnterDirect}
                disabled={starting}
              >
                {zh ? '单人场景' : 'Direct Chat'}
              </button>
            )}
            {onEnterDirect && onEnterCrew && <span aria-hidden="true">·</span>}
            {onEnterCrew && (
              <button
                type="button"
                className="cold-open__door-link"
                onClick={onEnterCrew}
                disabled={starting}
              >
                {zh ? '群像会谈' : 'Crew Debate'}
              </button>
            )}
          </p>
        )}
      </aside>
    </div>
  )
}

export default ColdOpenLanding
