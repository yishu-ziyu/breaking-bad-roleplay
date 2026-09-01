import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseSseChunk } from './sseFetch'

describe('parseSseChunk', () => {
  it('parses named events and leaves a partial tail', () => {
    const { events, rest } = parseSseChunk(
      'event: beat_ready\ndata: {"ok":true}\n\nevent: agent_speak\ndata: {"x":1}\n',
    )
    assert.equal(events.length, 1)
    assert.equal(events[0].event, 'beat_ready')
    assert.equal(events[0].data, '{"ok":true}')
    assert.equal(rest, 'event: agent_speak\ndata: {"x":1}\n')
  })

  it('joins multi-line data', () => {
    const { events } = parseSseChunk('event: status\ndata: a\ndata: b\n\n')
    assert.equal(events[0].data, 'a\nb')
  })

  it('counts consumed frames (incl. comment heartbeats) without emitting events', () => {
    const { events, frames } = parseSseChunk(
      ': ping\n\nevent: x\ndata: {"ok":true}\n\n: ping\n',
    )
    assert.equal(events.length, 1)
    assert.equal(events[0].event, 'x')
    // Two complete frames were consumed; the trailing ': ping\n' is a
    // partial tail and must not count as activity yet.
    assert.equal(frames, 2)
  })
})
