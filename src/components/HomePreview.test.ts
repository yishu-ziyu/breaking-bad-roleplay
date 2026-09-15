import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomePreview } from './HomePreview'

test('homepage distinguishes story and conversation entry and labels recorded output', () => {
  const html = renderToStaticMarkup(createElement(HomePreview, { onStory: () => {}, onChat: () => {}, onCrew: () => {} }))
  assert.match(html, /开始故事/)
  assert.match(html, /与角色聊天/)
  assert.match(html, /群像会谈/)
  assert.match(html, /实际生成片段/)
  assert.match(html, /不是实时对话/)
  assert.doesNotMatch(html, /进入这一夜|看过，直接开始/)
})

test('all seven playable characters are available and the six new portraits are used', () => {
  const html = renderToStaticMarkup(createElement(HomePreview, { onStory: () => {}, onChat: () => {}, onCrew: () => {} }))
  for (const name of ['沃尔特·怀特', '杰西·平克曼', '索尔·古德曼', '斯凯勒·怀特', '迈克·厄曼特劳特', '古斯·弗林', '汉克·施拉德']) {
    assert.ok(html.includes(`aria-label="和${name}聊天"`), `missing entry for ${name}`)
  }
  assert.ok(!html.includes('aria-label="和玛丽·施拉德聊天"'), 'Marie must not be a playable chat entry')
  for (const id of ['jesse', 'saul', 'skyler', 'mike', 'gus', 'hank']) {
    assert.ok(html.includes(`/avatars/illustrated/${id}.png`), `missing new portrait for ${id}`)
  }
  assert.ok(!html.includes('/avatars/illustrated/marie.png'), 'Marie must not be offered as a playable portrait')
  assert.match(html, /\/avatars\/desert-noir\/walter.jpg/)
})
