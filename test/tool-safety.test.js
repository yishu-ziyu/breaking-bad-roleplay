import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

// The old Node.js agent code has been removed.  This test now checks the
// Python backend prompt files for the same safety constraint: no operational
// drug-production, money-laundering, or weapon terms should appear in the
// character prompts or director system prompt.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(__dirname, '..', 'backend', 'agents')

const filesToCheck = [
  path.join(backendDir, 'director.py'),
  path.join(backendDir, 'characters', 'base.py'),
]

test('fictional tool descriptions avoid operational drug and laundering terms', () => {
  const forbidden = /\b(methamphetamine|precursor|dirty_cash|launder|money_launder|amphetamine)\b/i

  for (const file of filesToCheck) {
    const source = readFileSync(file, 'utf8')
    assert.equal(
      forbidden.test(source),
      false,
      `Found forbidden operational term in ${file}`,
    )
  }
})
