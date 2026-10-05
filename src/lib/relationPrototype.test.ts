import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RELATION_EXPLANATIONS,
  relationExplanation,
  relationLockCopy,
  relationPrototypeEnabled,
  relationPrototypeSelectedWord,
} from './relationPrototype.ts'

const REQUIRED_KEYS = [
  'family member',
  'lab partner',
  'former student',
  'DEA liability',
  'partner',
  'old friend',
  'dealer contact',
  'person he disappointed',
  'spouse',
  'neighbor',
  'person hiding something',
  'client',
  'business partner',
  'witness',
  'problem to solve',
  'asset',
  'employer',
  'person under protection',
  'loose end',
  'employee',
  'supplier',
  'guest',
  'person being evaluated',
  'DEA partner',
  'suspect under watch',
  'friend of the family',
  'Skyler sister-in-law',
  'Hank spouse',
  'supportive but uncomprehending',
]

describe('relation prototype flag', () => {
  it('turns on only for relproto=1 in query or hash', () => {
    assert.equal(relationPrototypeEnabled('?relproto=1'), true)
    assert.equal(relationPrototypeEnabled('?surface=direct&relproto=1'), true)
    assert.equal(relationPrototypeEnabled('', '#relproto=1'), true)
    assert.equal(relationPrototypeEnabled('?relproto=0'), false)
    assert.equal(relationPrototypeEnabled('?relproto=yes'), false)
    assert.equal(relationPrototypeEnabled(''), false)
    assert.equal(relationPrototypeEnabled('?authoring=1'), false)
  })
})

describe('relation prototype copy', () => {
  it('has a one-line explanation for every Direct/Crew relation option', () => {
    for (const key of REQUIRED_KEYS) {
      assert.ok(RELATION_EXPLANATIONS[key], `missing ${key}`)
      assert.ok(RELATION_EXPLANATIONS[key].zh.trim().length > 0, `${key} zh`)
      assert.ok(RELATION_EXPLANATIONS[key].en.trim().length > 0, `${key} en`)
    }
  })

  it('returns the selected-language explanation and a safe fallback', () => {
    assert.match(relationExplanation('family member', 'zh'), /家/)
    assert.match(relationExplanation('family member', 'en'), /family/i)
    assert.equal(relationExplanation('not-a-relation', 'zh'), '')
  })

  it('explains the lock in both Chinese and English', () => {
    const zh = relationLockCopy('zh')
    const en = relationLockCopy('en')
    assert.match(zh, /开聊/)
    assert.match(zh, /对话/)
    assert.match(en, /first message/i)
    assert.match(en, /chat/i)
    assert.notEqual(zh, en)
  })

  it('marks the selected option in words, not only colour', () => {
    assert.equal(relationPrototypeSelectedWord('zh'), '已选')
    assert.equal(relationPrototypeSelectedWord('en'), 'Selected')
  })
})
