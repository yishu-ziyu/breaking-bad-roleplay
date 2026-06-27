import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildUrls, relationSlug } from '../lib/voiceUrls.ts'

describe('VoicePlayer URL builder', () => {
  it('builds relation-specific URL and fallback', () => {
    const urls = buildUrls('walter', 'former student')
    assert.deepEqual(urls, ['/voice/walter-former-student.mp3', '/voice/walter.mp3'])
  })

  it('relationSlug normalizes spaces and special chars', () => {
    assert.equal(relationSlug('DEA liability'), 'dea-liability')
    assert.equal(relationSlug('person with cash'), 'person-with-cash')
  })
})
