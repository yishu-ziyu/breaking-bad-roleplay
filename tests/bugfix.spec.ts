/**
 * SDD+TDD tests for SSE Client (B3) and StoryPanel (B4) bug fixes.
 *
 * Run: npx tsx --test tests/bugfix.spec.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { HEARTBEAT_TIMEOUT, HEARTBEAT_TOLERANCE } from '../src/lib/sseClient.ts'

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

// ===================================================================
// B3: Heartbeat timeout configuration
// ===================================================================

describe('B3: Heartbeat timeout', () => {
  it('HEARTBEAT_TIMEOUT is >= 30s to survive complex beat processing', () => {
    const minAcceptable = 30_000
    assert.ok(
      HEARTBEAT_TIMEOUT >= minAcceptable,
      `HEARTBEAT_TIMEOUT is ${HEARTBEAT_TIMEOUT}ms, expected >= ${minAcceptable}ms`
    )
  })

  it('HEARTBEAT_TIMEOUT + HEARTBEAT_TOLERANCE < 60s (reasonable upper bound)', () => {
    const maxAcceptable = 60_000
    assert.ok(
      HEARTBEAT_TIMEOUT + HEARTBEAT_TOLERANCE < maxAcceptable,
      'Total heartbeat window should stay under 60s'
    )
  })
})

// ===================================================================
// B4: React key stability
// ===================================================================

import { readFileSync } from 'node:fs'

describe('B4: Event key stability', () => {
  it('StoryPanel should use deterministic keys, not Math.random()', () => {
    const source = readFileSync(`${PROJECT_ROOT}src/components/StoryPanel.tsx`, 'utf8')
    const randomKeyPattern = /key=.*Math\.random\(\)/g
    const matches = source.match(randomKeyPattern)
    assert.equal(matches, null,
      `Found Math.random() in key expression: ${matches?.join(', ')} — keys must be deterministic`
    )
  })

  it('StoryPanel key should reference event.id or event.type', () => {
    const source = readFileSync(`${PROJECT_ROOT}src/components/StoryPanel.tsx`, 'utf8')
    const hasIdReference = /key=.*event\.(id|type)/.test(source)
    assert.ok(hasIdReference, 'Key should reference event.id or event.type for stability')
  })
})
