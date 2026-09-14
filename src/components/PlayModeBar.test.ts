import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlayModeBar } from './PlayModeBar.tsx'

test('play mode bar shows Story / Direct / Crew as three equal choices', () => {
  const html = renderToStaticMarkup(
    createElement(PlayModeBar, {
      value: 'story',
      language: 'zh',
      onChange: () => {},
    }),
  )
  assert.match(html, /play-mode-bar/)
  assert.match(html, />剧情</)
  assert.match(html, />单聊</)
  assert.match(html, />群聊</)
  assert.match(html, /aria-pressed="true"[^>]*>剧情</)
  assert.doesNotMatch(html, /单人场景|群像会谈|单聊·不推进/)
})
