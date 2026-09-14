/**
 * ColdOpenLanding — first-run door.
 *
 * First-run: Saul greets, then play mode (Story / Direct / Crew).
 * Story then asks whether you've seen the show. Parent owns session wiring.
 */

import { useId, useState } from 'react'
import { ElementSquare } from '../lib/ElementSquare'
import { Silhouette } from '../lib/silhouette'

import type { ColdOpenChoiceId, ColdOpenLanguage, KnowledgeTrack } from './coldOpenCopy'
import {
  BRIEF_COPY,
  COLD_OPEN_PROMPTS,
  INTRO_COPY,
  MODE_COPY,
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
  /** First visit shows the game intro before mode choice. */
  showIntro?: boolean
  onIntroDone?: () => void
}

export function ColdOpenLanding({
  language,
  knowledgeTrack,
  onKnowledgePick,
  onStart,
  onOpenSettings,
  onLanguageChange,
  starting = false,
  error = null,
  onEnterDirect,
  onEnterCrew,
  showIntro = true,
  onIntroDone,
}: ColdOpenLandingProps) {
  const titleId = useId()
  const zh = language === 'zh'
  const ui = UI_COPY[language]
  const intro = INTRO_COPY[language]
  const modes = MODE_COPY[language]
  const locked = starting
  const [doorStep, setDoorStep] = useState<'intro' | 'modes' | 'story-knowledge'>(
    showIntro ? 'intro' : 'modes',
  )

  const beginNight = (track: KnowledgeTrack) => {
    if (locked) return
    onKnowledgePick(track)
    onStart(briefStartPayload(track, language))
  }

  const finishIntro = () => {
    if (locked) return
    onIntroDone?.()
    setDoorStep('modes')
  }

  const pickStory = () => {
    if (locked) return
    if (knowledgeTrack) {
      beginNight(knowledgeTrack)
      return
    }
    setDoorStep('story-knowledge')
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

      <aside
        className="cold-open__door"
        aria-label={
          doorStep === 'intro'
            ? intro.speaker
            : doorStep === 'modes'
              ? modes.question
              : BRIEF_COPY[language].question
        }
      >
        {doorStep === 'intro' ? (
          <>
            <div className="cold-open__intro-cast">
              <span className="cold-open__intro-face">
                <Silhouette characterId="saul" name={intro.speaker} size={72} />
              </span>
              <cite className="cold-open__intro-speaker">{intro.speaker}</cite>
            </div>
            <p className="cold-open__intro-line">{intro.line}</p>
            <button
              type="button"
              className="cold-open__pill cold-open__pill--loud"
              onClick={finishIntro}
              disabled={locked}
            >
              {intro.cta}
            </button>
          </>
        ) : doorStep === 'modes' ? (
          <>
            <h3 className="cold-open__door-q">{modes.question}</h3>
            <div className="cold-open__modes" role="group" aria-label={modes.question}>
              <button
                type="button"
                className="cold-open__mode"
                aria-label={modes.story.title}
                onClick={pickStory}
                disabled={locked}
              >
                <span className="cold-open__mode-title">{modes.story.title}</span>
                <span className="cold-open__mode-hint">{modes.story.hint}</span>
              </button>
              {onEnterDirect && (
                <button
                  type="button"
                  className="cold-open__mode"
                  aria-label={modes.direct.title}
                  onClick={onEnterDirect}
                  disabled={locked}
                >
                  <span className="cold-open__mode-title">{modes.direct.title}</span>
                  <span className="cold-open__mode-hint">{modes.direct.hint}</span>
                </button>
              )}
              {onEnterCrew && (
                <button
                  type="button"
                  className="cold-open__mode"
                  aria-label={modes.crew.title}
                  onClick={onEnterCrew}
                  disabled={locked}
                >
                  <span className="cold-open__mode-title">{modes.crew.title}</span>
                  <span className="cold-open__mode-hint">{modes.crew.hint}</span>
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="cold-open__door-back"
              onClick={() => setDoorStep('modes')}
              disabled={locked}
            >
              {modes.back}
            </button>
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
          </>
        )}
      </aside>
    </div>
  )
}

export default ColdOpenLanding
