/**
 * ColdOpenLanding — 电影级三栏展台冷启动大门 (方案 B 生产正式落地)
 *
 * 首屏直出 3 种核心玩法卡片 (Story / Direct / Crew)
 * 融入 motion-web 物理弹簧阻尼跟随 (Spring-Damper 3D Tilt) 与电影级视觉材质
 */

import { useId, useRef, useState, useEffect, useCallback } from 'react'

import type { ColdOpenChoiceId, ColdOpenLanguage, KnowledgeTrack } from './coldOpenCopy'
import {
  SHOWCASE_COPY,
  UI_COPY,
  briefStartPayload,
} from './coldOpenCopy'
import { storyCardClickOutcome, storyComingSoonCopy } from '../lib/storyAvailability'
import { StoryComingSoonNotice } from './StoryComingSoonNotice'

export type { ColdOpenChoiceId, ColdOpenLanguage, KnowledgeTrack }

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
  /**
   * Story gate (T10, 2026-09-18). Visitors get a "剧情正在开发中" notice instead
   * of the knowledge dialog / story start; authors keep the full flow.
   * Defaults to closed: a caller that forgets the switch must not open Story.
   */
  storyOpen?: boolean
  /** Historical prop kept for interface compatibility */
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
  storyOpen = false,
}: ColdOpenLandingProps) {
  const titleId = useId()
  const zh = language === 'zh'
  const ui = UI_COPY[language]
  const copy = SHOWCASE_COPY[language]
  const storySoon = storyComingSoonCopy(language)
  const locked = starting

  const [dialogOpen, setDialogOpen] = useState(false)
  /** Visitor tried the closed STORY card — show why, without leaving the door. */
  const [storyClosedNotice, setStoryClosedNotice] = useState(false)

  const card1Ref = useRef<HTMLDivElement>(null)
  const card2Ref = useRef<HTMLDivElement>(null)
  const card3Ref = useRef<HTMLDivElement>(null)

  // 挂载 motion-web 弹簧阻尼 3D Tilt 动效
  const attachSpringTilt = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    let currentX = 0
    let currentY = 0
    let targetX = 0
    let targetY = 0
    let isHovered = false
    let animId: number

    const onMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left - rect.width / 2
      const y = e.clientY - rect.top - rect.height / 2
      targetX = -(y / (rect.height / 2)) * 6
      targetY = (x / (rect.width / 2)) * 6
      isHovered = true
    }

    const onMouseLeave = () => {
      targetX = 0
      targetY = 0
      isHovered = false
    }

    const tick = () => {
      const damping = 0.12
      currentX += (targetX - currentX) * damping
      currentY += (targetY - currentY) * damping

      if (isHovered || Math.abs(currentX) > 0.05 || Math.abs(currentY) > 0.05) {
        el.style.transform = `rotateX(${currentX.toFixed(2)}deg) rotateY(${currentY.toFixed(2)}deg) translateY(${isHovered ? -8 : 0}px)`
      } else {
        el.style.transform = ''
      }
      animId = requestAnimationFrame(tick)
    }

    el.addEventListener('mousemove', onMouseMove)
    el.addEventListener('mouseleave', onMouseLeave)
    animId = requestAnimationFrame(tick)

    return () => {
      el.removeEventListener('mousemove', onMouseMove)
      el.removeEventListener('mouseleave', onMouseLeave)
      cancelAnimationFrame(animId)
    }
  }, [])

  useEffect(() => {
    const cleanup1 = attachSpringTilt(card1Ref.current)
    const cleanup2 = attachSpringTilt(card2Ref.current)
    const cleanup3 = attachSpringTilt(card3Ref.current)
    return () => {
      cleanup1?.()
      cleanup2?.()
      cleanup3?.()
    }
  }, [attachSpringTilt])

  const beginStoryWithTrack = (track: KnowledgeTrack) => {
    if (locked) return
    onKnowledgePick(track)
    setDialogOpen(false)
    onStart(briefStartPayload(track, language))
  }

  const handleStoryClick = () => {
    if (locked) return
    // T10: closed Story never opens the dialog or calls onStart. The decision
    // itself lives in the shared gate so both states are unit-tested.
    const outcome = storyCardClickOutcome({
      storyOpen,
      hasKnowledgeTrack: Boolean(knowledgeTrack),
    })
    if (outcome === 'blocked') {
      setStoryClosedNotice(true)
      return
    }
    if (outcome === 'start' && knowledgeTrack) {
      beginStoryWithTrack(knowledgeTrack)
      return
    }
    setDialogOpen(true)
  }

  return (
    <div
      className="cold-open-showcase"
      role="dialog"
      aria-modal="true"
      aria-busy={starting || undefined}
      aria-labelledby={titleId}
    >
      {/* 全屏暗调环境背景 */}
      <div className="showcase-bg" aria-hidden="true" />
      <div className="showcase-vignette" aria-hidden="true" />

      {/* 顶部状态栏 */}
      <header className="showcase-hud">
        <div className="showcase-hud__brand">
          <div className="showcase-chem-logo" aria-hidden="true">
            <div className="showcase-chem-sq green">Br</div>
            <div className="showcase-chem-sq">Ba</div>
          </div>
          <span className="showcase-hud__title">{copy.brandTitle}</span>
        </div>

        <div className="showcase-hud__actions">
          {onLanguageChange && (
            <div className="showcase-lang-toggle" role="group" aria-label={zh ? '语言' : 'Language'}>
              <button
                type="button"
                className={`showcase-lang-btn ${language === 'zh' ? 'is-active' : ''}`}
                onClick={() => onLanguageChange('zh')}
                aria-pressed={language === 'zh'}
                disabled={starting}
              >
                中文
              </button>
              <button
                type="button"
                className={`showcase-lang-btn ${language === 'en' ? 'is-active' : ''}`}
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
              className="showcase-settings-btn"
              onClick={onOpenSettings}
              aria-label={ui.settings}
              disabled={starting}
            >
              {ui.settings}
            </button>
          )}
        </div>
      </header>

      {error ? (
        <div className="cold-open__error" role="alert" style={{ zIndex: 110 }}>
          {error}
        </div>
      ) : null}

      {/* 展台主体 */}
      <main className="showcase-container">
        <section className="showcase-hero">
          <h1 className="showcase-hero__title" id={titleId}>
            {copy.title}
          </h1>
          <p className="showcase-hero__sub">{copy.subtitle}</p>
        </section>

        <div className="showcase-grid" role="group" aria-label={copy.subtitle}>
          {/* ==================== 卡片 1：互动剧情 (Story) ==================== */}
          <article
            ref={card1Ref}
            className={`showcase-card showcase-card--story${storyOpen ? '' : ' is-story-closed'}`}
            onClick={handleStoryClick}
            aria-label={copy.story.badge}
            aria-disabled={storyOpen ? undefined : true}
            data-story-open={storyOpen ? 'true' : 'false'}
          >
            <div className="card-story-bg" aria-hidden="true" />
            <div className="card-story-overlay" aria-hidden="true" />
            <div className="siren-sweep" aria-hidden="true" />

            <div className="showcase-card__top">
              <span className="showcase-card__badge badge-story">{copy.story.badge}</span>
              {!storyOpen && (
                <span className="showcase-card__soon" data-testid="story-coming-soon">
                  {storySoon.badge}
                </span>
              )}
            </div>

            <div className="showcase-card__bottom">
              <div className="crisis-chips">
                <span className="crisis-chip">{copy.story.chip1}</span>
                <span className="crisis-chip">{copy.story.chip2}</span>
              </div>
              <h2 className="showcase-card__title">{copy.story.title}</h2>
              <p className="showcase-card__summary">{copy.story.desc}</p>
              <button
                type="button"
                className="showcase-card__btn"
                disabled={locked}
              >
                <span>{copy.story.cta}</span>
                <span>→</span>
              </button>
              {!storyOpen && storyClosedNotice && (
                <StoryComingSoonNotice language={language} className="showcase-card__notice" />
              )}
            </div>
          </article>

          {/* ==================== 卡片 2：角色对话 (Direct) ==================== */}
          <article
            ref={card2Ref}
            className="showcase-card showcase-card--direct"
            onClick={() => {
              if (locked) return
              onEnterDirect?.()
            }}
            aria-label={copy.direct.badge}
          >
            <div className="cast-slice-stage" aria-hidden="true">
              <div className="cast-slice-overlay" />
              <div className="avatars-fan">
                <div className="avatar-card-item">
                  <img src="/avatars/desert-noir/walter.jpg" alt="老白" />
                </div>
                <div className="avatar-card-item">
                  <img src="/avatars/illustrated/jesse.png" alt="小粉" />
                </div>
                <div className="avatar-card-item">
                  <img src="/avatars/illustrated/gus.png" alt="炸鸡叔" />
                </div>
                <div className="avatar-card-item">
                  <img src="/avatars/illustrated/saul.png" alt="索尔" />
                </div>
                <div className="avatar-card-item">
                  <img src="/avatars/illustrated/mike.png" alt="麦克" />
                </div>
                <div className="avatar-card-item hank-crop">
                  <img src="/avatars/illustrated/hank.png" alt="汉克" />
                </div>
              </div>
            </div>

            <div className="showcase-card__top">
              <span className="showcase-card__badge badge-direct">{copy.direct.badge}</span>
            </div>

            <div className="showcase-card__bottom">
              <h2 className="showcase-card__title">{copy.direct.title}</h2>
              <p className="showcase-card__summary">{copy.direct.desc}</p>
              <button
                type="button"
                className="showcase-card__btn"
                disabled={locked}
              >
                <span>{copy.direct.cta}</span>
                <span>→</span>
              </button>
            </div>
          </article>

          {/* ==================== 卡片 3：群像会谈 (Crew) ==================== */}
          <article
            ref={card3Ref}
            className="showcase-card showcase-card--crew"
            onClick={() => {
              if (locked) return
              onEnterCrew?.()
            }}
            aria-label={copy.crew.badge}
          >
            <div className="crew-scene-bg" aria-hidden="true" />
            <div className="crew-scene-overlay" aria-hidden="true" />
            <div className="neon-flicker" aria-hidden="true" />

            <div className="showcase-card__top">
              <span className="showcase-card__badge badge-crew">{copy.crew.badge}</span>
            </div>

            <div className="crew-standoff-stage">
              <div className="crew-factions">
                <div className="faction-tag">{copy.crew.faction}</div>
                <div className="faction-tag"><span>{copy.crew.allPresent}</span></div>
              </div>

              <div className="crew-cinematic-dialogue">
                <div className="cinematic-line">
                  <strong>{copy.crew.line1Speaker}</strong>
                  {copy.crew.line1Text}
                </div>
                <div className="cinematic-line">
                  <strong>{copy.crew.line2Speaker}</strong>
                  {copy.crew.line2Text}
                </div>
              </div>
            </div>

            <div className="showcase-card__bottom">
              <h2 className="showcase-card__title">{copy.crew.title}</h2>
              <p className="showcase-card__summary">{copy.crew.desc}</p>
              <button
                type="button"
                className="showcase-card__btn"
                disabled={locked}
              >
                <span>{copy.crew.cta}</span>
                <span>→</span>
              </button>
            </div>
          </article>
        </div>
      </main>

      {/* 剧情知识点选择弹窗 */}
      {dialogOpen && (
        <div className="showcase-dialog-backdrop" role="dialog" aria-modal="true">
          <div className="showcase-dialog">
            <h3 className="showcase-dialog__title">{copy.knowledgeDialog.question}</h3>
            <div className="showcase-dialog__options">
              <button
                type="button"
                className="showcase-dialog__btn"
                onClick={() => beginStoryWithTrack('fan')}
                disabled={locked}
              >
                <div className="showcase-dialog__btn-title">{copy.knowledgeDialog.fan}</div>
                <div className="showcase-dialog__btn-desc">{copy.knowledgeDialog.fanHint}</div>
              </button>
              <button
                type="button"
                className="showcase-dialog__btn"
                onClick={() => beginStoryWithTrack('fresh')}
                disabled={locked}
              >
                <div className="showcase-dialog__btn-title">{copy.knowledgeDialog.fresh}</div>
                <div className="showcase-dialog__btn-desc">{copy.knowledgeDialog.freshHint}</div>
              </button>
            </div>
            <button
              type="button"
              className="showcase-dialog__cancel"
              onClick={() => setDialogOpen(false)}
              disabled={locked}
            >
              {copy.knowledgeDialog.back}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ColdOpenLanding
