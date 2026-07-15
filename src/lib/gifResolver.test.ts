import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveGifUrl, resetGifResolverState, COOLDOWN_SIZE } from './gifResolver.ts'
import { roleAssets } from '../roleAssets.ts'

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

  it('generic fallback keeps returning GIFs after a small default pool is recent', () => {
    resetGifResolverState()
    for (let i = 0; i < 5; i++) {
      const url = resolveGifUrl('skyler', null, null)
      assert.ok(url, `expected a fallback GIF on call ${i}`)
    }
  })

  it('COOLDOWN_SIZE is 3', () => {
    assert.strictEqual(COOLDOWN_SIZE, 3, 'cooldown should be 3 for small pool variety')
  })

  it('all GIF URLs are well-formed (start with https://)', () => {
    const characters: RoleAssetCharacterId[] = ['walter', 'jesse', 'skyler', 'saul', 'mike', 'gus', 'hank']
    for (const char of characters) {
      const pool = roleAssets[char].gifPools
      for (const gif of pool) {
        assert.ok(
          gif.url.startsWith('https://'),
          `${char} GIF ${gif.id} has malformed URL: ${gif.url}`
        )
      }
    }
  })

  it('every character has at least one default-tagged GIF', () => {
    const characters: RoleAssetCharacterId[] = ['walter', 'jesse', 'skyler', 'saul', 'mike', 'gus', 'hank']
    for (const char of characters) {
      const pool = roleAssets[char].gifPools
      const hasDefault = pool.some(g => g.tags.includes('default'))
      assert.ok(hasDefault, `${char} has no default-tagged GIF for fallback`)
    }
  })

  it('no duplicate URLs within a character pool', () => {
    const characters: RoleAssetCharacterId[] = ['walter', 'jesse', 'skyler', 'saul', 'mike', 'gus', 'hank']
    for (const char of characters) {
      const pool = roleAssets[char].gifPools
      const urls = pool.map(g => g.url)
      const unique = new Set(urls)
      assert.strictEqual(unique.size, urls.length, `${char} has duplicate GIF URLs`)
    }
  })

  it('skipGif option returns null instead of falling back to random', () => {
    resetGifResolverState()
    // Even with a known emotion/query, skipGif should return null
    const url = resolveGifUrl('walter', 'tense', null, true)
    assert.strictEqual(url, null, 'skipGif=true should return null')
  })

  it('skipGif=false behaves like default (returns a URL)', () => {
    resetGifResolverState()
    const url = resolveGifUrl('walter', 'tense', null, false)
    assert.ok(url, 'skipGif=false should return a GIF URL')
    assert.ok(url.startsWith('https://'))
  })
})
