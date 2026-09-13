import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { quotaBlocksPlay } from './quotaPolicy.ts'

describe('quotaBlocksPlay', () => {
  it('does not wall developers when quota is open', () => {
    assert.equal(quotaBlocksPlay({ open: true, byok: false, remaining: 0 }), false)
    assert.equal(quotaBlocksPlay({ open: true, byok: false, remaining: 3 }), false)
  })

  it('still walls a closed guest meter at zero', () => {
    assert.equal(quotaBlocksPlay({ open: false, byok: false, remaining: 0 }), true)
    assert.equal(quotaBlocksPlay({ open: false, byok: false, remaining: 3 }), false)
    assert.equal(quotaBlocksPlay({ open: false, byok: true, remaining: 0 }), false)
  })
})
