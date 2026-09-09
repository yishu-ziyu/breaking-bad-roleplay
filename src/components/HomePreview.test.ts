import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomePreview } from './HomePreview'

test('homepage distinguishes story and conversation entry and labels recorded output', () => {
  const html = renderToStaticMarkup(createElement(HomePreview, { onStory: () => {}, onChat: () => {} }))
  assert.match(html, /开始故事/)
  assert.match(html, /与角色聊天/)
  assert.match(html, /实际生成片段/)
  assert.match(html, /不是实时对话/)
  assert.doesNotMatch(html, /进入这一夜|看过，直接开始/)
})

test('all eight playable characters are available and the seven new portraits are used', () => {
  const html = renderToStaticMarkup(createElement(HomePreview, { onStory: () => {}, onChat: () => {} }))
  for (const name of ['沃尔特·怀特', '杰西·平克曼', '索尔·古德曼', '斯凯勒·怀特', '迈克·厄曼特劳特', '古斯·弗林', '汉克·施拉德', '玛丽·施拉德']) {
    assert.ok(html.includes(`aria-label="和${name}聊天"`), `missing entry for ${name}`)
  }
  for (const id of ['jesse', 'saul', 'skyler', 'mike', 'gus', 'hank', 'marie']) {
    assert.ok(html.includes(`/avatars/illustrated/${id}.png`), `missing new portrait for ${id}`)
  }
  assert.match(html, /\/avatars\/desert-noir\/walter.jpg/)
})
