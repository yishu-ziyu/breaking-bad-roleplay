import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StorySceneBillboard } from './StorySceneBillboard'
import { buildStorySceneBill } from '../lib/storyScene.ts'

test('场面卡 shows place, crisis, and on-stage faces — not gacha or chat bubbles', () => {
  const bill = buildStorySceneBill({
    choiceId: 'clean_scene',
    characterId: 'walter',
    language: 'zh',
    knowledgeTrack: 'fan',
  })
  const html = renderToStaticMarkup(
    createElement(StorySceneBillboard, {
      bill,
      holding: false,
      onRaiseCurtain: () => {},
    }),
  )
  assert.match(html, /story-scene-bill/)
  assert.match(html, /开演/)
  assert.match(html, /在场/)
  assert.doesNotMatch(html, /msg--user|msg--char/)
  assert.doesNotMatch(html, /gacha|抽卡|Gacha|token probability|Phrase Bias|Hypebot/i)
})

test('holding state keeps the same scene and does not look like a chat wait', () => {
  const bill = buildStorySceneBill({
    choiceId: 'find_jesse',
    characterId: 'jesse',
    language: 'en',
    knowledgeTrack: 'fresh',
  })
  const html = renderToStaticMarkup(
    createElement(StorySceneBillboard, {
      bill,
      holding: true,
      onRaiseCurtain: () => {},
    }),
  )
  assert.match(html, /story-scene-bill/)
  assert.match(html, /aria-busy/)
  assert.doesNotMatch(html, /Connecting…|Connecting\.\.\./)
})
