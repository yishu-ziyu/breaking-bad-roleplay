/* SDD: when the story cannot start (or a beat is rejected) the player must see
 * a plain-language notice plus a retry entry — never a bare server string. */

import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StoryFailureNotice } from './StoryFailureNotice'
import { createStorySession, sessionFailureFromStart } from '../lib/storySessionStart'

const APP_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../App.tsx'),
  'utf8',
)
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

test('stub /api/session/create → 500: the panel shows a plain Chinese notice and a retry button', async () => {
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ detail: 'Internal Server Error' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch

  const result = await createStorySession({
    taskPrompt: '房车外的车灯越来越近。',
    characterId: 'walter',
    language: 'zh',
  })
  assert.equal(result.ok, false)
  if (result.ok) return

  const failure = sessionFailureFromStart(result)
  assert.ok(failure, 'a failed start must classify into a failure')

  const html = renderToStaticMarkup(createElement(StoryFailureNotice, {
    failure,
    language: 'zh',
    onRetry: () => {},
    onReset: () => {},
    resetLabel: '重新开始',
  }))

  assert.match(html, /role="alert"/)
  assert.match(html, /剧情没能开始/, 'headline must say plainly that the story did not start')
  assert.match(html, /重试/, 'a retry button must be offered')
  assert.match(html, /同一段开场/, 'retry copy must promise the identical opening setup')
  assert.doesNotMatch(html, /Internal Server Error/, 'raw server text must not be the player-facing line')
  assert.doesNotMatch(html, /\[object Object\]/)
})

test('an error event in the stream shows a visible beat notice in both languages', () => {
  const failure = { kind: 'beat_rejected' as const, status: null, detail: 'beat rejected by validator' }
  const zh = renderToStaticMarkup(createElement(StoryFailureNotice, {
    failure,
    language: 'zh',
    onRetry: () => {},
  }))
  assert.match(zh, /role="alert"/)
  assert.match(zh, /这一拍/)
  assert.match(zh, /重试/)
  assert.doesNotMatch(zh, /beat rejected by validator/)

  const en = renderToStaticMarkup(createElement(StoryFailureNotice, {
    failure,
    language: 'en',
    onRetry: () => {},
  }))
  assert.match(en, /beat/i)
  assert.match(en, /Retry/)
  assert.doesNotMatch(en, /beat rejected by validator/)
})

test('a failed resume renders the same plain card in both languages', () => {
  const failure = {
    kind: 'resume_failed' as const,
    status: 500,
    detail: 'Failed to restore story state (500)',
  }
  const zh = renderToStaticMarkup(createElement(StoryFailureNotice, {
    failure,
    language: 'zh',
    onRetry: () => {},
  }))
  assert.match(zh, /role="alert"/)
  assert.match(zh, /上次的剧情/)
  assert.match(zh, /重试/)
  assert.doesNotMatch(zh, /Failed to restore story state/)

  const en = renderToStaticMarkup(createElement(StoryFailureNotice, {
    failure,
    language: 'en',
    onRetry: () => {},
  }))
  assert.match(en, /story/i)
  assert.match(en, /Retry/)
  assert.doesNotMatch(en, /Failed to restore story state/)
})

test('App renders the session failure notice and can retry with the same opening', () => {
  assert.match(APP_SOURCE, /story\.sessionFailure/)
  assert.match(APP_SOURCE, /StoryFailureNotice/)
  assert.match(APP_SOURCE, /handleRetryStoryStart|retryStoryAfterFailure/)
})
