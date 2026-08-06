import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildColdOpenSuggestions,
  buildBeatPauseSuggestions,
} from './DramaDecisionBar.tsx'
import {
  COLD_OPEN_PROMPTS,
  type ColdOpenChoiceId,
} from './ColdOpenLanding.tsx'

const CHOICE_KEYS: ColdOpenChoiceId[] = [
  'find_jesse',
  'clean_scene',
  'call_saul',
  'free',
]

function assertThreeUniqueKinds(
  items: ReturnType<typeof buildColdOpenSuggestions>,
) {
  assert.equal(items.length, 3)
  assert.deepEqual(
    items.map((s) => s.kind).sort(),
    ['do', 'observe', 'say'],
  )
  for (const s of items) {
    assert.ok(s.id.length > 0)
    assert.ok(s.label.length > 0)
    assert.ok(s.payload.length > 0)
  }
}

test('buildColdOpenSuggestions returns 3 items with kinds say / do / observe (en)', () => {
  const items = buildColdOpenSuggestions('en')
  assertThreeUniqueKinds(items)
})

test('buildColdOpenSuggestions returns 3 items with kinds say / do / observe (zh)', () => {
  const items = buildColdOpenSuggestions('zh')
  assertThreeUniqueKinds(items)
})

test('buildColdOpenSuggestions branches by choiceId and keeps unique kinds', () => {
  for (const choiceId of CHOICE_KEYS) {
    for (const language of ['en', 'zh'] as const) {
      const items = buildColdOpenSuggestions(language, { choiceId })
      assertThreeUniqueKinds(items)
    }
  }
  const findLabels = buildColdOpenSuggestions('zh', { choiceId: 'find_jesse' }).map(
    (s) => s.label,
  )
  const cleanLabels = buildColdOpenSuggestions('zh', { choiceId: 'clean_scene' }).map(
    (s) => s.label,
  )
  const saulLabels = buildColdOpenSuggestions('zh', { choiceId: 'call_saul' }).map(
    (s) => s.label,
  )
  assert.notDeepEqual(findLabels, cleanLabels)
  assert.notDeepEqual(cleanLabels, saulLabels)
  assert.notDeepEqual(findLabels, saulLabels)
})

test('buildColdOpenSuggestions as jesse avoids third-person Jesse observe', () => {
  const items = buildColdOpenSuggestions('zh', {
    choiceId: 'find_jesse',
    characterId: 'jesse',
  })
  assertThreeUniqueKinds(items)
  const joined = items.map((s) => `${s.label} ${s.payload}`).join(' ')
  assert.ok(
    !/观察杰西|盯着杰西/.test(joined),
    'jesse cast should not use third-person observe-Jesse copy',
  )
})

test('COLD_OPEN_PROMPTS has all choice keys with en and zh seeds', () => {
  for (const key of CHOICE_KEYS) {
    assert.ok(key in COLD_OPEN_PROMPTS, `missing choice key: ${key}`)
    const entry = COLD_OPEN_PROMPTS[key]
    assert.equal(typeof entry.en, 'string')
    assert.equal(typeof entry.zh, 'string')
    assert.ok(entry.en.trim().length > 0, `${key}.en empty`)
    assert.ok(entry.zh.trim().length > 0, `${key}.zh empty`)
  }
  assert.deepEqual(
    Object.keys(COLD_OPEN_PROMPTS).sort(),
    [...CHOICE_KEYS].sort(),
  )
})

test('buildBeatPauseSuggestions still returns three kind-diverse options', () => {
  const plain = buildBeatPauseSuggestions('en')
  assert.equal(plain.length, 3)
  assert.deepEqual(
    plain.map((s) => s.kind).sort(),
    ['do', 'observe', 'say'],
  )
  const withHint = buildBeatPauseSuggestions('zh', '现金')
  assert.ok(withHint.some((s) => s.payload.includes('现金')))
})
