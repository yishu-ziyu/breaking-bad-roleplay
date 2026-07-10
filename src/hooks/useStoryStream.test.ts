import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { beatIndexFromBeatId, deriveBeatProgressFromMessages, pingSession } from './useStoryStream'

const originalFetch = globalThis.fetch

describe('useStoryStream pingSession', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns alive for an existing saved session using the public messages endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return { ok: true } as Response
    }) as typeof fetch

    const alive = await pingSession('sess-123')

    assert.equal(alive, 'alive')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/session/sess-123/messages?limit=1')
    assert.equal(calls[0].init?.method, 'GET')
  })

  it('returns missing for a missing saved session', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 404 }) as Response) as typeof fetch

    const alive = await pingSession('missing-session')

    assert.equal(alive, 'missing')
  })

  it('returns error when the probe request throws', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch

    const alive = await pingSession('network-error')

    assert.equal(alive, 'error')
  })

  it('returns error for transient server failures so storage is not cleared', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 503 }) as Response) as typeof fetch

    const alive = await pingSession('temporarily-unavailable')

    assert.equal(alive, 'error')
  })
})

describe('useStoryStream beat progress helpers', () => {
  it('parses backend beat ids into 1-based display indexes', () => {
    assert.equal(beatIndexFromBeatId('beat_1'), 1)
    assert.equal(beatIndexFromBeatId('beat-12'), 12)
    assert.equal(beatIndexFromBeatId('scene_12'), null)
    assert.equal(beatIndexFromBeatId(null), null)
  })

  it('restores progress from the latest persisted message beat id', () => {
    const progress = deriveBeatProgressFromMessages([
      { beat_id: 'beat_4' },
      { beat_id: 'beat_1' },
    ])

    assert.deepEqual(progress, { beatId: 'beat_1', beatIndex: 1 })
  })

  it('falls back to no progress when restored messages have no parseable beat id', () => {
    const progress = deriveBeatProgressFromMessages([
      { beat_id: null },
      { beat_id: 'unknown' },
    ])

    assert.deepEqual(progress, { beatId: null, beatIndex: 0 })
  })
})
