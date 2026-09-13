import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ColdOpenLanding.tsx'), 'utf8')

test('default new-user brief reaches Direct and Crew without Story', () => {
  assert.match(src, /onEnterDirect/)
  assert.match(src, /onEnterCrew/)
  assert.match(src, /单人场景/)
  assert.match(src, /群像会谈/)
})
