import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomePreview } from '../components/HomePreview.tsx'
import {
  PLAYABLE_CHARACTER_IDS,
  coercePlayableCharacterId,
  isPlayableCharacterId,
} from '../roleProfiles.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function charactersArraySource(): string {
  const app = readFileSync(join(ROOT, 'App.tsx'), 'utf8')
  const start = app.indexOf('const characters: Character[] = [')
  const end = app.indexOf('const relationLabels')
  assert.ok(start >= 0 && end > start, 'App.tsx must declare characters before relationLabels')
  return app.slice(start, end)
}

describe('playable identity: Marie is not a selectable Direct/Crew character', () => {
  it('does not list marie in the App character picker', () => {
    const block = charactersArraySource()
    assert.doesNotMatch(block, /id:\s*'marie'/)
    assert.doesNotMatch(block, /name:\s*'Marie'/)
  })

  it('does not offer Marie as a HomePreview chat entry', () => {
    const html = renderToStaticMarkup(
      createElement(HomePreview, { onStory: () => {}, onChat: () => {}, onCrew: () => {} }),
    )
    assert.doesNotMatch(html, /aria-label="和玛丽·施拉德聊天"/)
    assert.doesNotMatch(html, /MARIE SCHRADER/)
  })

  it('does not treat marie as a playable id, so a leftover Marie pick cannot speak as Walter while labeled Marie', () => {
    assert.equal(isPlayableCharacterId('marie'), false)
    assert.ok(!(PLAYABLE_CHARACTER_IDS as readonly string[]).includes('marie'))
    for (const id of PLAYABLE_CHARACTER_IDS) {
      assert.equal(isPlayableCharacterId(id), true)
    }
    const remapped = coercePlayableCharacterId('marie')
    assert.equal(isPlayableCharacterId(remapped), true)
    assert.notEqual(remapped, 'marie')
  })

  it('coerces unknown persisted ids onto a real playable character', () => {
    assert.equal(coercePlayableCharacterId('heisenberg'), 'walter')
    assert.equal(coercePlayableCharacterId('walter'), 'walter')
    assert.equal(coercePlayableCharacterId('hank'), 'hank')
  })

  it('App remaps a persisted marie id before sending chat', () => {
    const app = readFileSync(join(ROOT, 'App.tsx'), 'utf8')
    assert.match(app, /coercePlayableCharacterId/)
  })
})
