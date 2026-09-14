import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { briefStartPayload, COLD_OPEN_PROMPTS } from './coldOpenCopy.ts'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ColdOpenLanding.tsx'), 'utf8')

test('default new-user brief reaches Direct and Crew without Story', () => {
  assert.match(src, /onEnterDirect/)
  assert.match(src, /onEnterCrew/)
  assert.match(src, /单人场景/)
  assert.match(src, /群像会谈/)
  assert.match(src, /cold-open__door/)
  assert.match(src, /cold-open__pill--loud/)
  assert.doesNotMatch(src, /cold-open__play-mode/)
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
