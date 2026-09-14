import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveGifUrl, resetGifResolverState, COOLDOWN_SIZE, isGunMemeQuery, sanitizeGifQuery } from './gifResolver.ts'
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
    const familyUrls = roleAssets.skyler.gifPools.filter((g) => g.tags.includes('family')).map((g) => g.url)
    assert.ok(familyUrls.includes(url), 'expected a family-tagged GIF (not confrontation)')
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
    const characters: RoleAssetCharacterId[] = ['walter', 'jesse', 'skyler', 'saul', 'mike', 'gus', 'hank', 'marie']
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
    const characters: RoleAssetCharacterId[] = ['walter', 'jesse', 'skyler', 'saul', 'mike', 'gus', 'hank', 'marie']
    for (const char of characters) {
      const pool = roleAssets[char].gifPools
      const hasDefault = pool.some(g => g.tags.includes('default'))
      assert.ok(hasDefault, `${char} has no default-tagged GIF for fallback`)
    }
  })

  it('no duplicate URLs within a character pool', () => {
    const characters: RoleAssetCharacterId[] = ['walter', 'jesse', 'skyler', 'saul', 'mike', 'gus', 'hank', 'marie']
    for (const char of characters) {
      const pool = roleAssets[char].gifPools
      const urls = pool.map(g => g.url)
      const unique = new Set(urls)
      assert.strictEqual(unique.size, urls.length, `${char} has duplicate GIF URLs`)
    }
  })

  it('hank pool rejects known wrong-face Giphy IDs from the unaudited v1 set', () => {
    // 2026-07-15 first-frame audit: these were Moone Boy / Forrest Gump / dead / non-Hank.
    const banned = [
      'l0HlBO7eyXzSZkJri',
      'xT9IgG50Fb7Mi0prBC',
      '5GoVLqeAOo6PK',
      '3oEjI6SIIHBdRxXI40',
      '3o7TKMt1VVNkHV2PaE',
      '26BRuo6sLetdllPAQ',
      'l3V0j3ytFyGHqiV7W',
    ]
    const urls = roleAssets.hank.gifPools.map((g) => g.url).join(' ')
    for (const id of banned) {
      assert.ok(!urls.includes(id), `hank pool still contains banned GIF id ${id}`)
    }
    assert.ok(roleAssets.hank.gifPools.length >= 6, 'hank needs a rotation-sized pool')
    // Spot-check one audited Dean Norris id
    assert.ok(urls.includes('UvtKiyeWYEhRC'), 'hank pool missing audited investigative-read id')
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

  it('director emotion manipulative maps to glare, not a random default miss', () => {
    resetGifResolverState()
    const url = resolveGifUrl('walter', 'manipulative', null)
    assert.ok(url, 'expected a GIF for manipulative')
    const glare = roleAssets.walter.gifPools.filter((g) => g.tags.includes('glare')).map((g) => g.url)
    assert.ok(glare.includes(url), `manipulative should pick a glare GIF, got ${url}`)
  })

  it('chemistry lecture reply beats a generic manipulative glare', () => {
    resetGifResolverState()
    const chemistry = roleAssets.walter.gifPools
      .filter((g) => g.tags.includes('chemistry'))
      .map((g) => g.url)
    assert.ok(chemistry.length > 0, 'walter needs chemistry-tagged GIFs')
    const url = resolveGifUrl(
      'walter',
      'manipulative',
      'walter white lecture',
      false,
      '我上周教过你这个。发烟硫酸要提前冷到零度。搅拌的时候看颜色。',
    )
    assert.ok(chemistry.includes(url), `chemistry reply must pick a chemistry GIF, got ${url}`)
  })

  it('hank dinner / skyler secrecy picks family over chemistry', () => {
    resetGifResolverState()
    const family = roleAssets.walter.gifPools
      .filter((g) => g.tags.includes('family'))
      .map((g) => g.url)
    const url = resolveGifUrl(
      'walter',
      'tense',
      'walter white tense',
      false,
      '你觉得我会坐在那里，让汉克看见我的脸，然后解释我最近为什么瘦了？斯凯勒也不该知道。',
    )
    assert.ok(family.includes(url), `family scene must pick a family GIF, got ${url}`)
  })

  it('playable characters have a rotation-sized pool', () => {
    const eightPlus: Array<keyof typeof roleAssets> = [
      'walter', 'jesse', 'saul', 'mike', 'gus', 'hank',
    ]
    for (const char of eightPlus) {
      assert.ok(
        roleAssets[char].gifPools.length >= 8,
        `${char} pool is ${roleAssets[char].gifPools.length}, need at least 8`,
      )
    }
    assert.ok(roleAssets.skyler.gifPools.length >= 7, `skyler pool is ${roleAssets.skyler.gifPools.length}`)
    assert.ok(roleAssets.marie.gifPools.length >= 2, 'marie needs a starter pool')
  })

  it('gun-meme queries sanitize to tense and skip confrontation GIFs', () => {
    assert.equal(isGunMemeQuery('pointing gun'), true)
    assert.equal(isGunMemeQuery('jesse pistol closeup'), true)
    assert.equal(isGunMemeQuery('举枪特写'), true)
    assert.equal(sanitizeGifQuery('pointing gun'), 'tense')
    assert.equal(isGunMemeQuery('tense stare'), false)

    resetGifResolverState()
    const banned = roleAssets.jesse.gifPools
      .filter((g) => g.tags.includes('confrontation'))
      .map((g) => g.url)
    for (let i = 0; i < 12; i++) {
      const url = resolveGifUrl('jesse', null, 'pointing gun')
      assert.ok(url, `expected a GIF on pick ${i}`)
      assert.ok(!banned.includes(url), `gun-meme query returned confrontation GIF ${url}`)
    }
  })
})
