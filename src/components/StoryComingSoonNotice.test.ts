import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StoryComingSoonNotice } from './StoryComingSoonNotice.tsx'

function render(language: 'zh' | 'en', className?: string) {
  return renderToStaticMarkup(createElement(StoryComingSoonNotice, { language, className }))
}

test('notice states the plain reason in Chinese', () => {
  const html = render('zh')
  assert.match(html, /role="alert"/)
  assert.match(html, /剧情正在开发中/)
  assert.match(html, /暂时无法进入/)
  assert.match(html, /story-coming-soon/)
})

test('notice states the plain reason in English', () => {
  const html = render('en')
  assert.match(html, /role="alert"/)
  assert.match(html, /still in development/i)
  assert.match(html, /cannot be opened yet/i)
})

test('notice accepts an extra class for surface-specific placement', () => {
  const html = render('zh', 'play-mode-bar__notice')
  assert.match(html, /class="story-coming-soon play-mode-bar__notice"/)
})
