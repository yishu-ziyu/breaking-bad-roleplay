import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildColdOpenSuggestions,
  buildBeatPauseSuggestions,
  dramaSuggestionsForBeat,
  canSubmitFreeText,
  DRAMA_DECISION_COPY,
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

test('call_saul + saul cast uses receive-call chips, not dial Saul', () => {
  const zh = buildColdOpenSuggestions('zh', {
    choiceId: 'call_saul',
    characterId: 'saul',
  })
  assertThreeUniqueKinds(zh)
  const zhLabels = zh.map((s) => s.label)
  assert.deepEqual(zhLabels, ['接电话', '谈价', '编说辞'])
  const zhJoined = zh.map((s) => `${s.label} ${s.payload}`).join(' ')
  assert.ok(!/打给索尔/.test(zhJoined), 'saul cast must not dial Saul')

  const en = buildColdOpenSuggestions('en', {
    choiceId: 'call_saul',
    characterId: 'saul',
  })
  assertThreeUniqueKinds(en)
  const enLabels = en.map((s) => s.label)
  assert.deepEqual(enLabels, [
    'Answer the call',
    'Negotiate price',
    'Invent cover story',
  ])
  const enJoined = en.map((s) => `${s.label} ${s.payload}`).join(' ')
  assert.ok(!/Dial Saul/i.test(enJoined), 'saul cast must not dial Saul (en)')
})

test('call_saul without saul cast keeps dial Saul chips', () => {
  const dial = buildColdOpenSuggestions('zh', { choiceId: 'call_saul' })
  assertThreeUniqueKinds(dial)
  assert.ok(dial.some((s) => s.label === '打给索尔'))

  const asWalter = buildColdOpenSuggestions('zh', {
    choiceId: 'call_saul',
    characterId: 'walter',
  })
  assertThreeUniqueKinds(asWalter)
  assert.ok(asWalter.some((s) => s.label === '打给索尔'))
  assert.notDeepEqual(
    asWalter.map((s) => s.label),
    ['接电话', '谈价', '编说辞'],
  )
})

test('canSubmitFreeText only true when trimmed non-empty and not disabled', () => {
  assert.equal(canSubmitFreeText(''), false)
  assert.equal(canSubmitFreeText('   '), false)
  assert.equal(canSubmitFreeText('go'), true)
  assert.equal(canSubmitFreeText('go', true), false)
  assert.equal(canSubmitFreeText('', true), false)
})

test('continue label is primary long form with arrow (not bare 继续 / Continue)', () => {
  assert.equal(DRAMA_DECISION_COPY.zh.continue, '继续推进 →')
  assert.equal(DRAMA_DECISION_COPY.en.continue, 'Continue →')
  assert.ok(!/^继续$/.test(DRAMA_DECISION_COPY.zh.continue))
  assert.ok(!/^Continue$/.test(DRAMA_DECISION_COPY.en.continue))
})

test('disabled diegetic status is explicit, not silent gray only', () => {
  assert.equal(DRAMA_DECISION_COPY.zh.unfolding, '局面展开中…')
  assert.equal(DRAMA_DECISION_COPY.en.unfolding, 'The scene is unfolding…')
})

test('free submit label stays tertiary Decide / 决定', () => {
  assert.equal(DRAMA_DECISION_COPY.zh.freeSubmit, '决定')
  assert.equal(DRAMA_DECISION_COPY.en.freeSubmit, 'Decide')
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

test('dramaSuggestionsForBeat: cold chips only on beat 0; beat 1+ drop call_saul crisis labels', () => {
  const coldOpts = { choiceId: 'call_saul', characterId: 'saul' }
  const pauseHint = '索尔已经接了电话'

  const beat0 = dramaSuggestionsForBeat(0, 'zh', coldOpts, pauseHint)
  assert.deepEqual(
    beat0.map((s) => s.label),
    ['接电话', '谈价', '编说辞'],
  )

  for (const beatIndex of [1, 2, 3]) {
    const later = dramaSuggestionsForBeat(beatIndex, 'zh', coldOpts, pauseHint)
    const labels = later.map((s) => s.label)
    assert.ok(!labels.includes('接电话'), `beat ${beatIndex} must not show 接电话`)
    assert.ok(!labels.includes('谈价'), `beat ${beatIndex} must not show 谈价`)
    assert.ok(!labels.includes('编说辞'), `beat ${beatIndex} must not show 编说辞`)
    assert.deepEqual(
      later.map((s) => s.id),
      buildBeatPauseSuggestions('zh', pauseHint).map((s) => s.id),
    )
  }
})
