import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGE_DWELL_MS,
  dwellRemainingMs,
  listStageCardIndices,
  nextCardPos,
} from './storyStagePacing.ts'

describe('listStageCardIndices', () => {
  it('keeps only stage card types in order', () => {
    const events = [
      { type: 'status' },
      { type: 'scene_change' },
      { type: 'agent_think' },
      { type: 'world_state_delta' },
      { type: 'agent_speak' },
      { type: 'agent_act' },
      { type: 'beat_ready' },
    ]
    assert.deepEqual(listStageCardIndices(events), [1, 2, 4, 5])
  })

  it('returns empty for no card events', () => {
    assert.deepEqual(listStageCardIndices([{ type: 'status' }, { type: 'outline' }]), [])
  })
})

describe('dwellRemainingMs', () => {
  it('is zero when nothing has been shown yet', () => {
    assert.equal(dwellRemainingMs(null, 1000), 0)
  })

  it('returns full dwell just after show', () => {
    assert.equal(dwellRemainingMs(1000, 1000, 7000), 7000)
  })

  it('counts down and floors at zero', () => {
    assert.equal(dwellRemainingMs(1000, 4000, 7000), 4000)
    assert.equal(dwellRemainingMs(1000, 9000, 7000), 0)
  })
})

describe('nextCardPos', () => {
  it('starts at 0 when cardPos is negative', () => {
    assert.equal(nextCardPos(-1, 3), 0)
  })

  it('advances until the last card', () => {
    assert.equal(nextCardPos(0, 3), 1)
    assert.equal(nextCardPos(1, 3), 2)
    assert.equal(nextCardPos(2, 3), null)
  })

  it('returns null when empty', () => {
    assert.equal(nextCardPos(0, 0), null)
  })
})

describe('STAGE_DWELL_MS', () => {
  it('defaults to the 7s sweet spot', () => {
    assert.equal(STAGE_DWELL_MS, 7000)
  })
})
