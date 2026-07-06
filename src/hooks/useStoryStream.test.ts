import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { pingSession } from './useStoryStream'

const originalFetch = globalThis.fetch

describe('useStoryStream pingSession', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns true for an existing saved session using the public messages endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return { ok: true } as Response
    }) as typeof fetch

    const alive = await pingSession('sess-123')

    assert.equal(alive, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/session/sess-123/messages?limit=1')
    assert.equal(calls[0].init?.method, 'GET')
  })

  it('returns false for a missing saved session', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 404 }) as Response) as typeof fetch

    const alive = await pingSession('missing-session')

    assert.equal(alive, false)
  })

  it('returns false when the probe request throws', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch

    const alive = await pingSession('network-error')

    assert.equal(alive, false)
  })
})
