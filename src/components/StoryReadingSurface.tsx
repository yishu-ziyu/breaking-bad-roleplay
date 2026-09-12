import React, { type ReactNode } from 'react'
import type { OnStageLore, ReadingBlock } from '../lib/storyReading'

export type StoryReadingSurfaceProps = {
  blocks: ReadingBlock[]
  lore: OnStageLore
  language: 'zh' | 'en'
  canRedraw: boolean
  onRedrawBeat: () => void
  slate?: ReactNode
  voice?: ReactNode
}

const COPY = {
  zh: {
    lore: '上场的事实',
    loreEmpty: '还没有新的事实上场。',
    redraw: '换一版这一拍',
    you: '你',
  },
  en: {
    lore: 'On stage now',
    loreEmpty: 'Nothing new is on stage yet.',
    redraw: 'Redraw this beat',
    you: 'You',
  },
} as const

export function StoryReadingSurface({
  blocks,
  lore,
  language,
  canRedraw,
  onRedrawBeat,
  slate,
  voice,
}: StoryReadingSurfaceProps) {
  void React
  const t = COPY[language]
  return (
    <div className="story-reading">
      <div className="story-manuscript" aria-label={language === 'zh' ? '剧情正文' : 'Story manuscript'}>
        {slate}
        <div className="story-manuscript__body">
          {blocks.map((block) => {
            if (block.kind === 'dialogue') {
              return (
                <p key={block.id} className="story-manuscript__dialogue">
                  {block.speaker ? <cite>{block.speaker}</cite> : null}
                  <span>{block.text}</span>
                </p>
              )
            }
            if (block.kind === 'player') {
              return (
                <p key={block.id} className="story-manuscript__player">
                  <cite>{t.you}</cite>
                  <span>{block.text}</span>
                </p>
              )
            }
            return (
              <p key={block.id} className="story-manuscript__prose">
                {block.text}
              </p>
            )
          })}
        </div>
        {voice}
        {canRedraw && (
          <button type="button" className="story-manuscript__redraw" onClick={onRedrawBeat}>
            {t.redraw}
          </button>
        )}
      </div>
      <aside
        className={`story-lore${lore.expanded ? ' is-expanded' : ''}`}
        aria-expanded={lore.expanded}
      >
        <h3>{t.lore}</h3>
        {lore.location && <p className="story-lore__place">{lore.location}</p>}
        {lore.facts.length === 0 ? (
          <p className="story-lore__empty">{t.loreEmpty}</p>
        ) : (
          <ul>
            {lore.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  )
}
