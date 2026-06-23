import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const promptSource = readFileSync(new URL('../server/agents/AgentContainer.ts', import.meta.url), 'utf8')

test('fictional tool descriptions avoid operational drug and laundering terms', () => {
  const forbidden = /\b(meth|precursor|185|dirty_cash|launder)\b/i

  assert.equal(forbidden.test(promptSource), false)
})
