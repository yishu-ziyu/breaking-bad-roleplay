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

// Relation options offered in src/App.tsx (characters[].relationOptions).
const RELATIONS: Record<string, string[]> = {
  walter: ['family member', 'lab partner', 'former student', 'DEA liability'],
  jesse: ['partner', 'old friend', 'dealer contact', 'person he disappointed'],
  skyler: ['spouse', 'family member', 'neighbor', 'person hiding something'],
  saul: ['client', 'business partner', 'witness', 'problem to solve'],
  mike: ['asset', 'employer', 'person under protection', 'loose end'],
  gus: ['employee', 'supplier', 'guest', 'person being evaluated'],
  hank: ['family member', 'DEA partner', 'suspect under watch', 'friend of the family'],
  marie: ['Skyler sister-in-law', 'Hank spouse', 'supportive but uncomprehending', 'neighbor'],
}

test('every character × relation has its own text-message openers', async () => {
  const { OPENERS_BY_RELATION } = await import('./directOpeners.ts') as {
    OPENERS_BY_RELATION: Record<string, Record<string, DirectOpener[]>>
  }
  for (const [id, relations] of Object.entries(RELATIONS)) {
    for (const rel of relations) {
      const pool = OPENERS_BY_RELATION[id]?.[rel] ?? []
      assert.ok(pool.length >= 2, `${id} / ${rel} needs at least 2 openers`)
      for (const o of pool) assert.ok(o.zh && o.en, `${id}/${o.id} needs zh + en`)
    }
  }
})

test('openers are text messages, not same-room scenes', async () => {
  const { OPENERS_BY_CHARACTER } = await import('./directOpeners.ts') as {
    OPENERS_BY_CHARACTER: Record<string, DirectOpener[]>
  }
  const inPerson = /坐[下吧。]|先坐|进来[吧说坐。]|柜台|门廊|洗手|进门/
  const inPersonEn = /\b(sit down|come in|counter|porch|wash your hands)\b/i
  for (const [id, pool] of Object.entries(OPENERS_BY_CHARACTER)) {
    for (const o of pool) {
      assert.doesNotMatch(o.zh, inPerson, `${id}/${o.id} zh`)
      assert.doesNotMatch(o.en, inPersonEn, `${id}/${o.id} en`)
    }
  }
})

test('the opener matches the relation the player picked', () => {
  const picked = pickDirectOpener({
    characterId: 'marie',
    language: 'zh',
    attitude: deriveAttitudeTint('Hank spouse'),
    relation: 'Hank spouse',
    recentIds: [],
  })
  assert.ok(picked)
  assert.match(picked.id, /^marie\.hank-spouse\./)
  assert.doesNotMatch(picked.text, /汉克不在/)
})
