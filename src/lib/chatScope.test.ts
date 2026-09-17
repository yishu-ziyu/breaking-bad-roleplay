import test from 'node:test'
import assert from 'node:assert/strict'
import { chatThreadKey, mergeLegacyChat } from './chatScope.ts'

test('cloud and local thread identities isolate Direct, Crew and legacy data', () => {
  const direct = chatThreadKey('direct', 'walter')
  const crew = chatThreadKey('crew', 'walter')
  assert.notEqual(direct, crew)
  assert.notEqual(direct, 'walter')
  assert.notEqual(crew, 'walter')
  assert.equal(direct, 'chat-v2:direct:walter')
})

test('legacy archive merges copies without changing source records', () => {
  const local = [{ sender: 'user', text: 'A private old message' }]
  const cloud = [{ ...local[0] }, { sender: 'jesse', text: 'An old group reply' }]
  assert.equal(mergeLegacyChat(local, cloud).length, 2)
  assert.equal(local.length, 1)
  assert.equal(cloud.length, 2)
})
