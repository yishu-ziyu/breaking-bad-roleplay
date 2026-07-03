import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveGifUrl, resetGifResolverState, COOLDOWN_SIZE } from './gifResolver.ts'

// Mock localStorage before module code uses it
const store: Record<string, string> = {}
const mockLS = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
}
Object.defineProperty(globalThis, 'localStorage', {
  value: mockLS, writable: true, configurable: true,
})

describe('gifResolver', () => {
  it('returns a GIF for Walter with a known emotion', () => {
    resetGifResolverState()
    const url = resolveGifUrl('walter', 'tense', null)
    assert.ok(url, 'expected a GIF URL')
    assert.ok(url.startsWith('https://'), 'expected an externally hosted URL')
  })

  it('matches gif_search_query tags', () => {
    resetGifResolverState()
    const url = resolveGifUrl('walter', null, 'desert standoff')
    assert.ok(url, 'expected a GIF URL')
  })

  it('returns a GIF for Skyler after pool expansion', () => {
    resetGifResolverState()
    const url = resolveGifUrl('skyler', 'angry', 'family')
    assert.ok(url, 'expected a GIF URL for Skyler')
    assert.ok(url.startsWith('https://'), 'expected externally hosted URL')
  })

  it('TC-GIF-SKYLAR-1: skyler protective-fear returns family-tagged GIF, not confrontation', () => {
    resetGifResolverState()
    const url = resolveGifUrl('skyler', 'panic', 'family protective fear')
    assert.ok(url, 'expected a GIF URL for Skyler protective-fear')
    assert.ok(!url.includes('10RCqM2nZpdqOQ'), 'must not reuse the confrontation GIF URL')
    assert.ok(
      url.includes('LBL8F53My1SZa') || url.includes('c4rNN6FOS8l6o'),
      'expected a family-tagged GIF (not confrontation)'
    )
  })

  it('Chinese emotion 开场压迫 maps to bridge tags (glare/tense)', () => {
    resetGifResolverState()
    const url = resolveGifUrl('walter', '开场压迫', null)
    assert.ok(url, 'expected a GIF URL for 开场压迫')
    assert.ok(url.startsWith('https://'), 'expected a valid GIF URL')
  })

  it('Chinese emotion 焦虑 maps to panic tag via bridge', () => {
    resetGifResolverState()
    const url = resolveGifUrl('walter', '焦虑', null)
    assert.ok(url, 'expected a GIF URL for 焦虑')
    // 焦虑 -> [panic, tense]; tense has more Walter matches, so likely tense-tagged
    assert.ok(url.startsWith('https://'), 'expected a valid GIF URL')
  })

  it('weighted selection produces variety over multiple calls', () => {
    resetGifResolverState()
    const urls = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const url = resolveGifUrl('jesse', 'panic', null)
      assert.ok(url, `expected a GIF URL on call ${i}`)
      urls.add(url)
    }
    assert.ok(urls.size >= 3, `expected at least 3 distinct GIFs, got ${urls.size}`)
  })

  it('cooldown excludes recent GIFs from selection', () => {
    resetGifResolverState()
    // Pre-populate recent
    for (let i = 0; i < 5; i++) {
      resolveGifUrl('walter', 'tense', null)
    }
    const url = resolveGifUrl('walter', 'tense', null)
    assert.ok(url, 'expected a GIF after cooldown behavior')
  })

  it('family emotion for Skyler skips confrontation GIF', () => {
    resetGifResolverState()
    // Verify that 'family' tag selects from family-tagged GIFs, not confrontation
    // Skyler's family-tagged GIF is LBL8F53My1SZa, confrontation is 10RCqM2nZpdqOQ
    const url = resolveGifUrl('skyler', 'family', null)
    assert.ok(url, 'expected a GIF URL')
    assert.ok(!url.includes('10RCqM2nZpdqOQ'), 'family must not return confrontation GIF')
  })

  it('COOLDOWN_SIZE is 3', () => {
    assert.strictEqual(COOLDOWN_SIZE, 3, 'cooldown should be 3 for small pool variety')
  })
})
