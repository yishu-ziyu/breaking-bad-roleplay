import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyPlaySurfaceToStorage, playSurfaceFromSearch } from './playEntry.ts'

describe('play entry from default new-user URL', () => {
  it('?surface=direct and ?surface=crew skip Story cold-open', () => {
    assert.equal(playSurfaceFromSearch('?surface=direct'), 'direct')
    assert.equal(playSurfaceFromSearch('surface=crew'), 'crew')
    assert.equal(playSurfaceFromSearch('?home=preview'), null)
    assert.equal(playSurfaceFromSearch(''), null)
  })

  it('writes enteredWorld so Direct/Crew are reachable without a Story run', () => {
    const store: Record<string, unknown> = { enteredWorld: false, surface: 'story' }
    const applied = applyPlaySurfaceToStorage('?surface=direct', (k, v) => {
      store[k] = v
    })
    assert.equal(applied, 'direct')
    assert.equal(store.enteredWorld, true)
    assert.equal(store.surface, 'direct')
  })
})
