import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StoryReadingSurface } from './StoryReadingSurface'
import {
  buildReadingBlocks,
  extractOnStageLore,
  type ReadingBlock,
} from '../lib/storyReading.ts'
import type { StoryEvent } from '../lib/storyFeed.ts'

function sampleEvents(): StoryEvent[] {
  return [
    { type: 'scene_change', data: { description: 'The office is too clean.', to_scene: 'Los Pollos office' } },
    { type: 'agent_speak', data: { character_id: 'Gus Fring', content: 'Please, sit.' } },
    { type: 'player_turn', data: { kind: 'say', content: 'I know what this meeting costs.' } },
    {
      type: 'world_state_delta',
      data: { deltas: [{ target: 'Walter', field: 'pride', old_value: 'hot', new_value: 'bitten' }] },
    },
  ]
}

test('reading surface is a manuscript, not a Direct chat thread', () => {
  const events = sampleEvents()
  const html = renderToStaticMarkup(
    createElement(StoryReadingSurface, {
      blocks: buildReadingBlocks(events, 'en'),
      lore: extractOnStageLore(events, 'en'),
      language: 'en',
      canRedraw: true,
      onRedrawBeat: () => {},
    }),
  )
  assert.match(html, /story-manuscript/)
  assert.match(html, /story-manuscript__dialogue/)
  assert.match(html, /story-manuscript__player/)
  assert.match(html, /Please, sit/)
  assert.match(html, /I know what this meeting costs/)
  assert.doesNotMatch(html, /msg--user|msg--char|story-scene-card__quote/)
  assert.doesNotMatch(html, /Phrase Bias|token probability|Hypebot|McKee/)
})

test('lore rail expands when facts are on stage', () => {
  const events = sampleEvents()
  const lore = extractOnStageLore(events, 'zh')
  assert.equal(lore.expanded, true)
  const html = renderToStaticMarkup(
    createElement(StoryReadingSurface, {
      blocks: buildReadingBlocks(events, 'zh') as ReadingBlock[],
      lore,
      language: 'zh',
      canRedraw: false,
      onRedrawBeat: () => {},
    }),
  )
  assert.match(html, /story-lore/)
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /pride/)
})
