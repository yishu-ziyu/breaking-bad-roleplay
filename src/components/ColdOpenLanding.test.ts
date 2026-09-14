import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ColdOpenLanding } from './ColdOpenLanding.tsx'
import { briefStartPayload, COLD_OPEN_PROMPTS, INTRO_COPY, MODE_COPY } from './coldOpenCopy.ts'

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

test('first visit is a game intro, not a mode menu', () => {
  const html = renderDoor(true)
  assert.match(html, /索尔·古德曼/)
  assert.match(html, /进来坐/)
  assert.match(html, /完蛋了/)
  assert.doesNotMatch(html, /说明书|你可以试一下|走进这场戏|进入阿尔伯克基/)
  assert.doesNotMatch(html, /aria-label="剧情"/)
  assert.doesNotMatch(html, /你要怎么进这场戏/)
  assert.equal(INTRO_COPY.zh.cta, '进来坐。')
  assert.equal(INTRO_COPY.en.cta, 'Sit down.')
})

test('door presents 剧情 / 单聊 / 群聊 as first-class choices', () => {
  const html = renderDoor()
  assert.match(html, /你要怎么进这场戏/)
  assert.match(html, /aria-label="剧情"/)
  assert.match(html, /aria-label="单聊"/)
  assert.match(html, /aria-label="群聊"/)
  assert.match(html, /cold-open__mode/)
  assert.doesNotMatch(html, /看过，直接开始/)
  assert.doesNotMatch(html, /也可以先/)
  assert.doesNotMatch(html, /单人场景|群像会谈/)
})

test('door panel sits in desert-noir, not a cream light-mode slab', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../App.css'), 'utf8')
  const door = css.slice(css.indexOf('.cold-open__door {'), css.indexOf('.cold-open__door-q {'))
  assert.match(door, /--dn-bg/)
  assert.match(door, /--dn-fg/)
  assert.doesNotMatch(door, /#f3ece0|#fffdf7|#1c1914/)
})

test('default new-user brief reaches Direct and Crew without Story', () => {
  assert.match(src, /onEnterDirect/)
  assert.match(src, /onEnterCrew/)
  assert.match(src, /MODE_COPY/)
  assert.match(src, /cold-open__door/)
  assert.equal(MODE_COPY.zh.direct.title, '单聊')
  assert.equal(MODE_COPY.zh.crew.title, '群聊')
  assert.equal(MODE_COPY.zh.story.title, '剧情')
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
