import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveAttitudeTint,
  pickDirectOpener,
  type AttitudeTint,
  type DirectOpener,
} from './directOpeners.ts'

test('M-thickness opener has life detail texture and a hook (not a lore dump)', () => {
  const picked = pickDirectOpener({
    characterId: 'walter',
    language: 'en',
    attitude: 'stranger',
    recentIds: [],
  })
  assert.ok(picked)
  assert.ok(picked.text.length > 20)
  assert.ok(picked.text.length < 220)
  // Must feel spoken, not third-person stage direction
  assert.doesNotMatch(picked.text, /^(He|She|Walter|The camera)\b/)
  assert.doesNotMatch(picked.text, /\b(choose one|option A|press continue)\b/i)
})

test('rotation skips recently used opener ids', () => {
  const first = pickDirectOpener({
    characterId: 'jesse',
    language: 'zh',
    attitude: 'soft',
    recentIds: [],
  })
  assert.ok(first)
  const second = pickDirectOpener({
    characterId: 'jesse',
    language: 'zh',
    attitude: 'soft',
    recentIds: [first!.id],
  })
  assert.ok(second)
  assert.notEqual(second.id, first.id)
})

test('attitude tint prefers matching pool, falls back if exhausted', () => {
  const torn = pickDirectOpener({
    characterId: 'mike',
    language: 'en',
    attitude: 'torn' satisfies AttitudeTint,
    recentIds: [],
  })
  assert.ok(torn)
  assert.equal(torn.attitude, 'torn')
})

test('open thread wins over random pool', () => {
  const picked = pickDirectOpener({
    characterId: 'saul',
    language: 'en',
    attitude: 'dealing',
    recentIds: [],
    openThread: 'you still owe him a call about the paperwork',
  })
  assert.ok(picked)
  assert.equal(picked.id.startsWith('thread-'), true)
  assert.match(picked.text.toLowerCase(), /paperwork|call|owe|还/)
})

test('deriveAttitudeTint maps relation + facts', () => {
  assert.equal(deriveAttitudeTint('family member', []), 'soft')
  assert.equal(deriveAttitudeTint('client', []), 'dealing')
  assert.equal(deriveAttitudeTint('suspect under watch', []), 'torn')
  assert.equal(deriveAttitudeTint('neighbor', []), 'stranger')
  assert.equal(
    deriveAttitudeTint('partner', [{ category: 'attitude_shift', fact: 'went cold after the fight' }]),
    'torn',
  )
})

test('openers stay in-scene — no conversation self-defense', async () => {
  const { OPENERS_BY_CHARACTER } = await import('./directOpeners.ts') as {
    OPENERS_BY_CHARACTER: Record<string, DirectOpener[]>
  }
  const banned =
    /calm conversation|unfortunate misunderstandings|another lecture|I am not here to|I can do \w+\.|我不是来|冷静的谈话|避免.*误会|说教|我可以礼貌/i
  for (const [id, pool] of Object.entries(OPENERS_BY_CHARACTER)) {
    for (const o of pool) {
      assert.doesNotMatch(o.en, banned, `${id}/${o.id} en`)
      assert.doesNotMatch(o.zh, banned, `${id}/${o.id} zh`)
    }
  }
})

test('each playable character ships at least 12 openers', async () => {
  const { OPENERS_BY_CHARACTER } = await import('./directOpeners.ts') as {
    OPENERS_BY_CHARACTER: Record<string, DirectOpener[]>
  }
  for (const id of ['walter', 'jesse', 'skyler', 'saul', 'mike', 'gus', 'hank', 'marie']) {
    assert.ok((OPENERS_BY_CHARACTER[id]?.length ?? 0) >= 12, `${id} opener library too small`)
  }
})
