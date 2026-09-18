import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = readFileSync(join(here, '../App.tsx'), 'utf8')
const landing = readFileSync(join(here, '../components/ColdOpenLanding.tsx'), 'utf8')
const bar = readFileSync(join(here, '../components/PlayModeBar.tsx'), 'utf8')

describe('story gate wiring (T10)', () => {
  it('App resolves the author switch at runtime, never at build time', () => {
    assert.match(app, /resolveAuthoringMode\(/)
    assert.match(app, /canEnterStory\(/)
    // Local dev and the deployed build run the same code path.
    assert.doesNotMatch(app, /import\.meta\.env/)
    assert.doesNotMatch(app, /process\.env/)
  })

  it('both STORY entry points receive the resolved switch', () => {
    // Cold-open card + the two PlayModeBar mounts (story HUD, chat header).
    const gates = app.match(/storyOpen=\{storyOpen\}/g) ?? []
    assert.ok(gates.length >= 3, `expected the switch on card + both bars, saw ${gates.length}`)
  })

  it('every in-product story entry consults the shared gate', () => {
    assert.match(landing, /storyCardClickOutcome/)
    assert.match(bar, /playModeBlocked/)
    // Settings drawer switch is a second way in — same guard, not a raw setSurface.
    assert.match(app, /playModeBlocked\(/)
  })

  it('no surface opens Story behind the gate', () => {
    assert.doesNotMatch(landing, /import\.meta\.env/)
    assert.doesNotMatch(bar, /import\.meta\.env/)
  })

  it('a stored visitor Story surface is reclaimed before enteredWorld hydrates', () => {
    // The reset must run in the same pre-paint block as the migrations: before
    // usePersistedState reads `enteredWorld`, so frame one is already the door.
    const reclaimAt = app.indexOf('reclaimVisitorStorySurfaceBeforePaint(storyOpen)')
    const hydrateAt = app.indexOf("usePersistedState<boolean>('enteredWorld'")
    assert.ok(reclaimAt > -1, 'App must run the visitor Story-surface reclaim')
    assert.ok(hydrateAt > -1, 'enteredWorld is still hydrated from storage')
    assert.ok(
      reclaimAt < hydrateAt,
      'the reclaim must run before enteredWorld is read, or the story frame flashes first',
    )
    // The reclaim itself must never run for authors.
    assert.match(app, /reclaimVisitorStorySurface\(\{/)
  })
})
