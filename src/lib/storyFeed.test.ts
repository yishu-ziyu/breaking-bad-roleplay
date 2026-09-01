/** P5② (full-stack review): the feed must NOT swallow legitimate repeated
 * dialogue. Regression guard for the old GLOBAL character+content dedup. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyIncomingEvent, MAX_FEED_EVENTS, type StoryEvent } from './storyFeed'

const speak = (character: string, content: string): StoryEvent => ({
  type: 'agent_speak',
  data: { character_id: character, content },
})
const status = (message: string): StoryEvent => ({ type: 'status', data: { message } })
const beat = (id: string): StoryEvent => ({ type: 'beat_ready', data: { beat_id: id } })

describe('storyFeed dedup (P5②)', () => {
  it('keeps a repeated line that is separated by other events', () => {
    let feed: StoryEvent[] = []
    feed = applyIncomingEvent(feed, speak('jesse', "I'm done."))
    feed = applyIncomingEvent(feed, speak('walter', 'Say again?'))
    feed = applyIncomingEvent(feed, speak('jesse', "I'm done."))
    assert.equal(feed.length, 3)
    assert.equal(feed[2].data.content, "I'm done.")
  })

  it('keeps a character repeating their own line across later beats', () => {
    let feed: StoryEvent[] = [speak('jesse', 'Yeah, science!')]
    feed = applyIncomingEvent(feed, beat('beat_1'))
    feed = applyIncomingEvent(feed, status('Beat 2 coming up'))
    feed = applyIncomingEvent(feed, speak('jesse', 'Yeah, science!'))
    assert.equal(feed.length, 4)
  })

  it('drops only an ADJACENT identical speak (reconnect echo)', () => {
    let feed: StoryEvent[] = [speak('walter', 'I am the danger.')]
    const before = feed
    feed = applyIncomingEvent(feed, speak('walter', 'I am the danger.'))
    assert.equal(feed, before, 'adjacent duplicate must be skipped without a new array')
  })

  it('drops a second beat_ready for the same beat id, keeps new beat ids', () => {
    let feed: StoryEvent[] = [beat('beat_1')]
    feed = applyIncomingEvent(feed, beat('beat_1'))
    assert.equal(feed.length, 1)
    feed = applyIncomingEvent(feed, beat('beat_2'))
    assert.equal(feed.length, 2)
  })

  it('stamps received_at and enforces the feed cap', () => {
    let feed: StoryEvent[] = []
    for (let i = 0; i < MAX_FEED_EVENTS + 50; i += 1) {
      feed = applyIncomingEvent(feed, status(`tick ${i}`))
    }
    assert.equal(feed.length, MAX_FEED_EVENTS)
    assert.equal(feed[0].data.message, 'tick 50') // oldest dropped
    assert.ok(feed[feed.length - 1].received_at)
  })

  it('does not merge different characters saying the same line adjacently', () => {
    let feed: StoryEvent[] = [speak('walter', 'Enough.')]
    feed = applyIncomingEvent(feed, speak('skyler', 'Enough.'))
    assert.equal(feed.length, 2)
  })
})
