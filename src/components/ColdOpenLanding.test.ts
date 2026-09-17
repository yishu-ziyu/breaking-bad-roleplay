import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ColdOpenLanding } from './ColdOpenLanding.tsx'
import { briefStartPayload, COLD_OPEN_PROMPTS } from './coldOpenCopy.ts'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ColdOpenLanding.tsx'), 'utf8')

function renderDoor(showIntro = false) {
  return renderToStaticMarkup(
    createElement(ColdOpenLanding, {
      language: 'zh',
      knowledgeTrack: null,
      onKnowledgePick: () => {},
      onStart: () => {},
      onEnterDirect: () => {},
      onEnterCrew: () => {},
      showIntro,
    }),
  )
}

test('first visit presents 3-card showcase (Story, Direct, Crew)', () => {
  const html = renderDoor(true)
  assert.match(html, /最好找个好律师/)
  assert.match(html, /或者，把知道秘密的人都摆平/)
  assert.match(html, /长线剧情演绎/)
  assert.match(html, /角色深度对话/)
  assert.match(html, /群像会谈/)
  assert.match(html, /开始故事/)
  assert.match(html, /选择角色对话/)
  assert.match(html, /进入群像会谈/)
})

test('showcase presents 互动剧情 / 角色对话 / 群像会谈 as first-class choices', () => {
  const html = renderDoor()
  assert.match(html, /STORY · 互动剧情/)
  assert.match(html, /DIRECT · 角色对话/)
  assert.match(html, /CREW · 群像会谈/)
  assert.match(html, /showcase-card--story/)
  assert.match(html, /showcase-card--direct/)
  assert.match(html, /showcase-card--crew/)
})

test('default new-user brief reaches Direct and Crew without Story', () => {
  assert.match(src, /onEnterDirect/)
  assert.match(src, /onEnterCrew/)
  assert.match(src, /onStart/)
  assert.match(src, /showcase-card/)
})

test('brief start payload enters the night as Walter with no prescribed move', () => {
  const fan = briefStartPayload('fan', 'zh')
  assert.equal(fan.characterId, 'walter')
  assert.equal(fan.choiceId, 'free')
  assert.equal(fan.storyPrompt, COLD_OPEN_PROMPTS.free.zh.fan)

  const fresh = briefStartPayload('fresh', 'en')
  assert.equal(fresh.characterId, 'walter')
  assert.equal(fresh.choiceId, 'free')
  assert.equal(fresh.storyPrompt, COLD_OPEN_PROMPTS.free.en.fresh)
})

test('brief pills start the night instead of opening a crisis quiz', () => {
  assert.match(src, /briefStartPayload/)
  assert.match(src, /onStart\(/)
  assert.doesNotMatch(src, /cold-open__stage--crisis/)
  assert.doesNotMatch(src, /cold-open__choice--primary/)
  assert.doesNotMatch(src, /cold-open__cast-member/)
})
