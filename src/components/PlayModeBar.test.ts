import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PlayModeBar } from './PlayModeBar.tsx'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PlayModeBar.tsx'), 'utf8')

function renderBar(
  storyOpen: boolean,
  language: 'zh' | 'en' = 'zh',
  value: 'story' | 'direct' | 'crew' = 'story',
) {
  return renderToStaticMarkup(
    createElement(PlayModeBar, {
      value,
      language,
      onChange: () => {},
      storyOpen,
    }),
  )
}

test('play mode bar shows Story / Direct / Crew as three equal choices', () => {
  const html = renderBar(true)
  assert.match(html, /play-mode-bar/)
  assert.match(html, />剧情</)
  assert.match(html, />单聊</)
  assert.match(html, />群聊</)
  assert.match(html, /aria-pressed="true"[^>]*>剧情</)
  assert.doesNotMatch(html, /单人场景|群像会谈|单聊·不推进/)
})

test('visitor state marks 剧情 as in development and leaves 单聊 / 群聊 alone', () => {
  const html = renderBar(false)
  assert.match(html, /aria-disabled="true"/)
  assert.match(html, /play-mode-bar__soon/)
  assert.match(html, /开发中/)
  assert.match(html, />单聊</)
  assert.match(html, />群聊</)
  // Marker must not steal the button's accessible name (E2E uses exact names).
  assert.match(html, /aria-hidden="true"[^>]*>开发中</)
})

test('author state leaves all three modes selectable with no marker', () => {
  const html = renderBar(true)
  assert.doesNotMatch(html, /开发中/)
  assert.doesNotMatch(html, /aria-disabled/)
  assert.doesNotMatch(html, /play-mode-bar__soon/)
})

test('English visitor state marks Story as in development', () => {
  const html = renderBar(false, 'en')
  assert.match(html, /In development/)
  assert.match(html, />Direct</)
})

test('blocked 剧情 click is decided by the shared story gate, not inline copy', () => {
  assert.match(src, /playModeBlocked\(/)
  assert.match(src, /StoryComingSoonNotice/)
  assert.doesNotMatch(src, /import\.meta\.env/)
})
