/**
 * SDD+TDD tests for SSE Client and StoryPanel bug fixes.
 *
 * Run: npx tsx --test tests/bugfix.spec.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

// ===================================================================
// B4: React key stability
// ===================================================================

describe('B4: Story event rendering', () => {
  it('App.tsx should not use Math.random() for event keys', () => {
    const source = readFileSync(`${PROJECT_ROOT}src/App.tsx`, 'utf8')
    const randomKeyPattern = /key=.*Math\.random\(\)/g
    const matches = source.match(randomKeyPattern)
    assert.equal(matches, null,
      `Found Math.random() in key expression: ${matches?.join(', ')} — keys must be deterministic`
    )
  })

  it('Story event keys should reference event.id or event.type', () => {
    const source = readFileSync(`${PROJECT_ROOT}src/App.tsx`, 'utf8')
    const hasIdReference = /key=.*evt\.(type|id)/.test(source)
    assert.ok(hasIdReference, 'Key should reference event.id or event.type for stability')
  })
})
