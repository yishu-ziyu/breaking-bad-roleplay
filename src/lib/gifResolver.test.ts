import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveGifUrl } from './gifResolver.ts'

describe('gifResolver', () => {
  it('returns a GIF for Walter with a known emotion', () => {
    const url = resolveGifUrl('walter', 'tense', null)
    assert.ok(url, 'expected a GIF URL')
    assert.ok(url.startsWith('https://'), 'expected an externally hosted URL')
  })

  it('matches gif_search_query tags', () => {
    const url = resolveGifUrl('walter', null, 'desert standoff')
    assert.ok(url, 'expected a GIF URL')
  })

  it('returns a GIF for Skyler after pool expansion', () => {
    const url = resolveGifUrl('skyler', 'angry', 'family')
    assert.ok(url, 'expected a GIF URL for Skyler')
    assert.ok(url.startsWith('https://'), 'expected externally hosted URL')
  })
})
