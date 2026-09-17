import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  STOP_RETRY_LIMIT,
  TURN_RETRY_LIMIT,
  stopRetryDelay,
  classifyCommandReality,
  transportEndVerdict,
  turnRetryDelay,
} from './storyRecovery'

describe('turnRetryDelay (bounded backoff, never an endless loop)', () => {
  it('backs off exponentially and then caps', () => {
    assert.equal(turnRetryDelay(0), 800)
    assert.equal(turnRetryDelay(1), 1600)
    assert.equal(turnRetryDelay(2), 3200)
    assert.equal(turnRetryDelay(3), 5000)
    assert.equal(turnRetryDelay(5), 5000)
  })

  it('returns null once the budget is spent so the caller must surface an error', () => {
    assert.equal(turnRetryDelay(TURN_RETRY_LIMIT), null)
    assert.equal(turnRetryDelay(TURN_RETRY_LIMIT + 5), null)
    assert.equal(turnRetryDelay(-1), null)
    assert.equal(turnRetryDelay(Number.NaN), null)
  })
})

describe('classifyCommandReality (old generator vs committed outbox)', () => {
  const snapshot = (over: Record<string, unknown>) => ({
    runtime_version: 1, status: 'waiting', world_revision: 1,
    pending_command_id: null, command_id: 'opening', ...over,
  })

  it('reports pending while the first stream still holds the generation token', () => {
    assert.equal(
      classifyCommandReality(snapshot({ pending_command_id: 'cmd-1' }), 'cmd-1'),
      'pending',
    )
  })

  it('reports committed once the same command is the last committed beat', () => {
    assert.equal(
      classifyCommandReality(snapshot({ command_id: 'cmd-1', world_revision: 2 }), 'cmd-1'),
      'committed',
    )
  })

  it('prefers pending over committed while a newer command is generating', () => {
    assert.equal(
      classifyCommandReality(snapshot({ pending_command_id: 'cmd-2', command_id: 'cmd-1' }), 'cmd-1'),
      'committed',
    )
    assert.equal(
      classifyCommandReality(snapshot({ pending_command_id: 'cmd-2', command_id: 'cmd-1' }), 'cmd-2'),
      'pending',
    )
  })

  it('reports absent when the server never received the command', () => {
    assert.equal(classifyCommandReality(snapshot({}), 'cmd-lost'), 'absent')
  })

  it('reports stopped/complete/paused before guessing about the command', () => {
    assert.equal(classifyCommandReality(snapshot({ status: 'stopped' }), 'cmd-1'), 'stopped')
    assert.equal(classifyCommandReality(snapshot({ status: 'complete' }), 'cmd-1'), 'complete')
    assert.equal(classifyCommandReality(snapshot({ status: 'paused' }), 'cmd-1'), 'paused')
  })

  it('stays unknown when the probe failed instead of resending blindly', () => {
    assert.equal(classifyCommandReality(null, 'cmd-1'), 'unknown')
  })
})

describe('transportEndVerdict (manual reconnect must not pop the error card)', () => {
  it('ignores a close after a real terminal state', () => {
    assert.equal(transportEndVerdict('beat_paused', false), 'ignore')
    assert.equal(transportEndVerdict('complete', false), 'ignore')
    assert.equal(transportEndVerdict('idle', false), 'ignore')
  })

  it('retries once when a fresh connect closes before any event', () => {
    assert.equal(transportEndVerdict('connecting', false), 'retry')
    assert.equal(transportEndVerdict('streaming', false), 'retry')
  })

  it('fails after the single silent retry is used', () => {
    assert.equal(transportEndVerdict('connecting', true), 'fail')
    assert.equal(transportEndVerdict('streaming', true), 'fail')
  })
})

describe('stopRetryDelay (Stop is confirmed, not assumed)', () => {
  it('re-asks a bounded number of times', () => {
    assert.equal(stopRetryDelay(0), 500)
    assert.equal(stopRetryDelay(1), 1000)
    assert.equal(stopRetryDelay(2), 2000)
    assert.equal(stopRetryDelay(STOP_RETRY_LIMIT), null)
    assert.equal(stopRetryDelay(-1), null)
  })
})
