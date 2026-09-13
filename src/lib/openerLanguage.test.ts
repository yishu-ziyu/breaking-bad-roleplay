import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isOpenerOnlyThread, syncOpenerLanguage } from './openerLanguage.ts'

const opener = {
  en: 'Choose your words carefully. The situation is already more delicate than you understand.',
  zh: '说话谨慎一点。这个局面已经比你理解的更微妙。',
}

describe('opener language follows the UI', () => {
  it('rewrites a first-visit English opener when the UI is Chinese', () => {
    const msgs = [
      {
        id: 'opener-walter',
        sender: 'walter',
        text: opener.en,
        emotion: 'opening pressure',
        gifQuery: null,
        gifUrl: null,
      },
    ]
    const next = syncOpenerLanguage(msgs, 'walter', opener, 'zh', '开场压迫')
    assert.equal(next?.[0].text, opener.zh)
    assert.equal(next?.[0].emotion, '开场压迫')
  })

  it('does not rewrite once the player has spoken', () => {
    const msgs = [
      { id: 'opener-walter', sender: 'walter', text: opener.en },
      { id: 'u1', sender: 'user', text: '钱已经够了。' },
    ]
    const next = syncOpenerLanguage(msgs, 'walter', opener, 'zh', '开场压迫')
    assert.equal(next, msgs)
  })

  it('recognizes opener-only threads', () => {
    assert.equal(isOpenerOnlyThread([{ id: 'opener-walter', sender: 'walter', text: 'x' }], 'walter'), true)
    assert.equal(isOpenerOnlyThread([{ id: 'm1', sender: 'walter', text: 'x' }], 'walter'), false)
  })
})
