import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getDirectWayfinders, isInspectableThinking } from './directWayfinders.ts'
import type { CharacterId } from '../roleProfiles.ts'

const CHARACTERS: CharacterId[] = [
  'walter', 'jesse', 'skyler', 'saul', 'mike', 'gus', 'hank', 'marie',
]

describe('direct wayfinders', () => {
  it('gives three scene-pressure openers per character, not helpdesk prompts', () => {
    for (const id of CHARACTERS) {
      for (const lang of ['zh', 'en'] as const) {
        const lines = getDirectWayfinders(id, lang)
        assert.equal(lines.length, 3, `${id} ${lang} needs three wayfinders`)
        const blob = lines.join('\n')
        assert.doesNotMatch(blob, /我需要你的建议|你最近怎么样|I could use your advice|How have you been/)
        assert.doesNotMatch(blob, /温度和步骤|how to cook|recipe/)
      }
    }
  })

  it('Walter starters name family pressure, not a request for tutoring', () => {
    const zh = getDirectWayfinders('walter', 'zh').join('\n')
    assert.match(zh, /汉克|斯凯勒/)
    assert.doesNotMatch(zh, /教我|步骤/)
  })
})

describe('inspectable thinking', () => {
  it('hides empty, one-word, and tag-only thinking', () => {
    assert.equal(isInspectableThinking(null), false)
    assert.equal(isInspectableThinking(''), false)
    assert.equal(isInspectableThinking('manipulative'), false)
    assert.equal(isInspectableThinking('tense'), false)
  })

  it('keeps a real sentence for on-demand inspection', () => {
    assert.equal(
      isInspectableThinking('He is testing whether I will protect Skyler.'),
      true,
    )
  })
})
