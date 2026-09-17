import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractDurableFacts,
  formatDurableMemoryForWire,
  mergeDurableFacts,
  type DurableFact,
} from './directDurableMemory.ts'

test('extracts open threads from promises and unanswered pressure', () => {
  const facts = extractDurableFacts('user', 'I promise I will keep Skyler out of this.')
  assert.ok(facts.some((f) => f.category === 'open_thread'))
})

test('extracts secrets / leverage', () => {
  const facts = extractDurableFacts('user', "Don't tell Hank about the laundry. Between us.")
  assert.ok(facts.some((f) => f.category === 'secret'))
})

test('extracts player-stable facts and agreements', () => {
  const facts = extractDurableFacts(
    'user',
    'Call me Alex. We agreed: no phones in the car.',
  )
  assert.ok(facts.some((f) => f.category === 'player_fact'))
  assert.ok(facts.some((f) => f.category === 'agreement'))
})

test('merge keeps newest unique facts and caps size', () => {
  const existing: DurableFact[] = [
    { category: 'secret', fact: 'old secret' },
  ]
  const merged = mergeDurableFacts(existing, [
    { category: 'secret', fact: 'old secret' },
    { category: 'open_thread', fact: 'still owes a call' },
  ], 2)
  assert.equal(merged.length, 2)
  assert.ok(merged.some((f) => f.fact.includes('owes')))
})

test('wire format is quiet instructions, not a dossier dump', () => {
  const text = formatDurableMemoryForWire([
    { category: 'open_thread', fact: 'promised to call about paperwork' },
    { category: 'attitude_shift', fact: 'went cold after the kitchen fight' },
  ])
  assert.match(text, /Relationship memory/)
  assert.match(text, /open_thread/)
  assert.match(text, /latest message has priority/i)
  assert.match(text, /Do not recite/)
})

test('Chinese identity, secrets, promises, shifts and agreements need no ASCII word boundaries', () => {
  const cases = [
    ['我叫小李', 'player_fact'],
    ['别告诉汉克这件事', 'secret'],
    ['我答应明天回来', 'open_thread'],
    ['从此我不再信任他', 'attitude_shift'],
    ['我们说好下次见面不带手机', 'agreement'],
  ] as const
  for (const [text, category] of cases) {
    assert.ok(extractDurableFacts('user', text).some((f) => f.category === category), text)
  }
})

test('character self-description is never mislabeled as a player fact', () => {
  const facts = extractDurableFacts('jesse', "I'm exhausted, man.")
  assert.equal(facts.some((fact) => fact.category === 'player_fact'), false)
})

test('thread churn cannot erase every stable identity, secret or agreement', () => {
  const stable: DurableFact[] = [
    { category: 'player_fact', fact: 'user: 我叫小李' },
    { category: 'secret', fact: 'user: 别告诉汉克' },
    { category: 'agreement', fact: 'jesse: 我们说好明天见' },
  ]
  const churn: DurableFact[] = Array.from({ length: 40 }, (_, i) => ({
    category: 'open_thread', fact: `user: I will discuss topic ${i}`,
  }))
  const result = mergeDurableFacts(stable, churn)
  assert.ok(result.length <= 24)
  for (const fact of stable) assert.ok(result.some((f) => f.fact === fact.fact))
})

test('wire memory respects 2000-character API limit and represents all five categories', () => {
  const categories = ['open_thread', 'secret', 'attitude_shift', 'player_fact', 'agreement'] as const
  const facts: DurableFact[] = Array.from({ length: 24 }, (_, i) => ({
    category: categories[i % categories.length], fact: `${i}: ${'长'.repeat(160)}`,
  }))
  const wire = formatDurableMemoryForWire(facts)
  assert.ok(wire.length <= 2000, `wire length ${wire.length}`)
  for (const category of categories) assert.ok(wire.includes(`[${category}]`))
})
