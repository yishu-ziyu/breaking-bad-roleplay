import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDirectChatMemory, DIRECT_RECENT_TURNS, toDirectChatMemoryWire } from './directChatMemory.ts'

function turns(count: number): { sender: string; text: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    sender: i % 2 === 0 ? 'user' : 'walter',
    text: i === 0
      ? 'First thing I said: the laundry is a front.'
      : i === 5
        ? 'Middle beat: I promised to keep Skyler out of it.'
        : `Turn ${i + 1}`,
  }))
}

test('short Direct chat sends the full transcript as recent, no opening pin', () => {
  const packed = buildDirectChatMemory(turns(6))
  assert.equal(packed.opening.length, 0)
  assert.equal(packed.digest, '')
  assert.equal(packed.recent.length, 6)
  assert.match(packed.recent[0].text, /laundry is a front/)
})

test('long Direct chat still pins the first user line after it falls out of recent', () => {
  const packed = buildDirectChatMemory(turns(24))
  assert.equal(packed.recent.length, DIRECT_RECENT_TURNS)
  assert.doesNotMatch(packed.recent.map((t) => t.text).join('\n'), /laundry is a front/)
  assert.match(packed.opening.map((t) => t.text).join('\n'), /laundry is a front/)
  assert.match(packed.digest, /promised to keep Skyler/)
})

test('opening pin includes the first reply when that reply is also outside recent', () => {
  const packed = buildDirectChatMemory(turns(24))
  assert.equal(packed.opening[0].sender, 'user')
  assert.ok(packed.opening.length >= 2)
  assert.equal(packed.opening[1].sender, 'walter')
})

test('canned character opener is not treated as the conversation opening', () => {
  const packed = buildDirectChatMemory([
    { sender: 'jesse', text: 'Yo, what do you want?' },
    ...turns(24),
  ])
  assert.equal(packed.opening[0].sender, 'user')
  assert.match(packed.opening[0].text, /laundry is a front/)
  assert.doesNotMatch(packed.opening.map((t) => t.text).join('\n'), /what do you want/)
})

test('Direct wire payload carries opening and digest; Crew only sends recent history', () => {
  const direct = toDirectChatMemoryWire('direct', turns(24))
  assert.equal(direct.history.length, DIRECT_RECENT_TURNS)
  assert.match(direct.memoryOpening.map((t) => t.text).join('\n'), /laundry is a front/)
  assert.match(direct.memoryDigest ?? '', /promised to keep Skyler/)

  const crew = toDirectChatMemoryWire('crew', turns(24))
  assert.equal(crew.history.length, DIRECT_RECENT_TURNS)
  assert.equal(crew.memoryOpening.length, 0)
  assert.equal(crew.memoryDigest, undefined)
})
