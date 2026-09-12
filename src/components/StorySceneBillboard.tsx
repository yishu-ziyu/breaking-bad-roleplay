import React from 'react'
import { characterPortrait } from '../lib/characterPortraits'
import type { StorySceneBill } from '../lib/storyScene'

export type StorySceneBillboardProps = {
  bill: StorySceneBill
  holding?: boolean
  onRaiseCurtain: () => void
}

export function StorySceneBillboard({
  bill,
  holding = false,
  onRaiseCurtain,
}: StorySceneBillboardProps) {
  void React
  return (
    <article
      className={`story-scene-bill${holding ? ' is-holding' : ''}`}
      aria-busy={holding || undefined}
      aria-label={bill.episodeTitle}
    >
      <p className="story-scene-bill__episode">{bill.episodeTitle}</p>
      <p className="story-scene-bill__place">{bill.place}</p>
      <p className="story-scene-bill__crisis">{bill.crisis}</p>
      <div className="story-scene-bill__cast">
        <span className="story-scene-bill__onstage">{bill.onStageLabel}</span>
        <ul>
          {bill.onStage.map((face) => (
            <li key={face.id} className={face.isYou ? 'is-you' : undefined}>
              <img src={characterPortrait(face.id)} alt="" />
              <span>
                {face.name}
                {face.isYou ? ` · ${bill.youTag}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="story-scene-bill__start"
        disabled={holding}
        onClick={onRaiseCurtain}
      >
        {holding ? bill.holdingLabel : bill.startLabel}
      </button>
    </article>
  )
}
