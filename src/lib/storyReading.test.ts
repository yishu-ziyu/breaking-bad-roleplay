import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { StoryEvent } from './storyFeed.ts'
import {
  buildReadingBlocks,
  canonicalBeatId,
  extractOnStageLore,
  trimFeedForBeatRedraw,
  trimFeedThroughBeat,
  inWorldPlayerLine,
  looksLikePlotEngineCopy,
} from './storyReading.ts'

const scene = (description: string): StoryEvent => ({
  type: 'scene_change',
  data: { description, to_scene: 'Desert RV' },
})
const speak = (character: string, content: string): StoryEvent => ({
  type: 'agent_speak',
  data: { character_id: character, content },
})
const think = (character: string, thought: string): StoryEvent => ({
  type: 'agent_think',
  data: { character_id: character, thought_content: thought },
})
const act = (character: string, action: string): StoryEvent => ({
  type: 'agent_act',
  data: { character_id: character, action },
})
const delta = (target: string, field: string, oldValue: string, newValue: string): StoryEvent => ({
  type: 'world_state_delta',
  data: { deltas: [{ target, field, old_value: oldValue, new_value: newValue }] },
})
const player = (content: string): StoryEvent => ({
  type: 'player_turn',
  data: { kind: 'say', content },
})
const beat = (id: string): StoryEvent => ({ type: 'beat_ready', data: { beat_id: id } })

describe('buildReadingBlocks (阅读)', () => {
  it('turns narration into continuous prose and dialogue into highlighted speech', () => {
    const blocks = buildReadingBlocks(
      [
        scene('The RV ticks as it cools. Ammonia hangs in the air.'),
        think('Walter White', 'If the headlights reach us, this is over.'),
        act('Walter White', 'wipes the condenser'),
        speak('Walter White', 'We are not leaving him out there.'),
        player('Jesse, stay in the dark until I call.'),
      ],
      'en',
    )
    const kinds = blocks.map((b) => b.kind)
    assert.ok(kinds.includes('narration'))
    assert.ok(kinds.includes('dialogue'))
    assert.ok(kinds.includes('player'))
    const dialogue = blocks.find((b) => b.kind === 'dialogue')
    assert.equal(dialogue?.speaker, 'Walter White')
    assert.equal(dialogue?.source, 'model')
    assert.match(dialogue?.text ?? '', /not leaving him/)
    const you = blocks.find((b) => b.kind === 'player')
    assert.equal(you?.source, 'user')
    assert.ok(!blocks.some((b) => b.kind === 'chat-bubble'))
  })

  it('does not put world deltas into the manuscript body', () => {
    const blocks = buildReadingBlocks(
      [speak('Jesse Pinkman', 'Yo.'), delta('Jesse', 'panic', 'contained', 'open')],
      'zh',
    )
    assert.equal(blocks.filter((b) => b.kind === 'dialogue').length, 1)
    assert.ok(!blocks.some((b) => /panic/.test(b.text)))
  })
})

describe('extractOnStageLore', () => {
  it('expands only when facts are on stage', () => {
    const empty = extractOnStageLore([speak('Walter White', 'Stay still.')], 'zh')
    assert.equal(empty.expanded, false)
    assert.equal(empty.facts.length, 0)

    const live = extractOnStageLore(
      [
        scene('Los Pollos office.'),
        delta('Walter', 'cover', 'intact', 'thin'),
      ],
      'en',
    )
    assert.equal(live.expanded, true)
    assert.ok(live.facts.some((f) => /Walter is thin/.test(f)))
    assert.ok(!live.facts.some((f) => f.includes('→') || / · /.test(f)))
    assert.ok(live.location)
  })
})

describe('trimFeedForBeatRedraw', () => {
  it('redraws the current beat and keeps earlier beats', () => {
    const events: StoryEvent[] = [
      scene('Beat one desert.'),
      speak('Walter White', 'First beat line.'),
      beat('beat_1'),
      scene('Beat two office.'),
      speak('Gus Fring', 'Second beat line.'),
      beat('beat_2'),
    ]
    const kept = trimFeedForBeatRedraw(events, 'beat_2')
    const text = kept.map((e) => JSON.stringify(e.data)).join(' ')
    assert.match(text, /First beat line/)
    assert.doesNotMatch(text, /Second beat line/)
    assert.ok(kept.some((e) => e.type === 'beat_ready' && e.data.beat_id === 'beat_1'))
  })

  it('does not rewind the whole night when redrawing beat 1', () => {
    const events: StoryEvent[] = [
      scene('Only night.'),
      speak('Walter White', 'Keep this? No.'),
      beat('beat_1'),
    ]
    assert.deepEqual(trimFeedForBeatRedraw(events, 'beat_1'), [])
  })
})

describe('trimFeedThroughBeat', () => {
  it('keeps the selected branch point and removes only its abandoned future', () => {
    const events: StoryEvent[] = [
      speak('Walter White', 'beat one'),
      beat('beat_1'),
      speak('Gus Fring', 'abandoned beat two'),
      beat('beat_2'),
    ]

    assert.deepEqual(trimFeedThroughBeat(events, 'beat_1'), events.slice(0, 2))
  })

  it('does not destroy the feed when the selected beat is missing', () => {
    const events: StoryEvent[] = [speak('Walter White', 'kept')]
    assert.deepEqual(trimFeedThroughBeat(events, 'beat_9'), events)
  })
})

describe('canonicalBeatId', () => {
  it('normalizes hyphen ids for the replay action', () => {
    assert.equal(canonicalBeatId('beat-2', 0), 'beat_2')
    assert.equal(canonicalBeatId(null, 3), 'beat_3')
    assert.equal(canonicalBeatId(null, 0), 'beat_1')
  })
})

describe('in-world copy', () => {
  it('turns lore deltas into prose without arrows or field codes', () => {
    const live = extractOnStageLore(
      [delta('杰西', '下落', '房车', '黑地')],
      'zh',
    )
    assert.equal(live.facts.length, 1)
    assert.match(live.facts[0], /杰西/)
    assert.match(live.facts[0], /黑地/)
    assert.doesNotMatch(live.facts[0], /→|下落|局面/)
  })

  it('rewrites engine-dump player lines into speech', () => {
    const blocks = buildReadingBlocks(
      [player('我直接点破压力点，逼对方表态：杰西 · 下落 房车 → 黑地')],
      'zh',
    )
    const you = blocks.find((b) => b.kind === 'player')
    assert.ok(you)
    assert.doesNotMatch(you?.text ?? '', /→|点破压力点|下落/)
    assert.ok(looksLikePlotEngineCopy('杰西 · 下落 房车 → 黑地'))
    assert.doesNotMatch(
      inWorldPlayerLine('我直接点破压力点，逼对方表态：杰西 · 下落 房车 → 黑地', 'say', 'zh'),
      /→/,
    )
  })
})

describe('pending player text (P0 unconfirmed acknowledgement)', () => {
  it('marks a player line the server has not confirmed yet', () => {
    const blocks = buildReadingBlocks([
      { type: 'player_turn', data: { content: '把手机交给杰西', kind: 'do', pending: true } },
    ], 'zh')
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].kind, 'player')
    assert.equal(blocks[0].pending, true)
  })

  it('does not mark committed player lines or dialogue', () => {
    const blocks = buildReadingBlocks([
      { type: 'player_turn', data: { content: '把手机交给杰西', kind: 'do' } },
      speak('Jesse Pinkman', '好，我拿着。'),
    ], 'zh')
    assert.equal(blocks[0].pending, false)
    assert.equal(blocks[1].kind, 'dialogue')
    assert.equal(blocks[1].pending, undefined)
  })
})
