import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStorySceneBill,
  holdsSceneCurtain,
} from './storyScene.ts'

describe('buildStorySceneBill (场面)', () => {
  it('puts place, crisis, and who is on stage before any SSE', () => {
    const bill = buildStorySceneBill({
      choiceId: 'find_jesse',
      characterId: 'walter',
      language: 'zh',
      knowledgeTrack: 'fan',
    })
    assert.ok(bill.place.length > 0)
    assert.ok(/沙漠|新墨西哥|RV|房车/i.test(bill.place + bill.crisis))
    assert.ok(bill.crisis.length > 0)
    const ids = bill.onStage.map((c) => c.id)
    assert.ok(ids.includes('walter'))
    assert.ok(ids.includes('jesse'))
    assert.ok(bill.onStage.some((c) => c.isYou && c.id === 'walter'))
    assert.equal(bill.startLabel, '开演')
    assert.doesNotMatch(bill.episodeTitle, /gacha|抽卡|卡牌/i)
  })

  it('puts Saul on stage when the crisis is the phone call', () => {
    const bill = buildStorySceneBill({
      choiceId: 'call_saul',
      characterId: 'walter',
      language: 'en',
      knowledgeTrack: 'fan',
    })
    assert.ok(bill.onStage.some((c) => c.id === 'saul'))
    assert.match(bill.startLabel, /Raise curtain|Begin/i)
  })

  it('always includes the player face even if they are not the default cook', () => {
    const bill = buildStorySceneBill({
      choiceId: 'find_jesse',
      characterId: 'jesse',
      language: 'zh',
      knowledgeTrack: 'fresh',
    })
    assert.ok(bill.onStage.some((c) => c.id === 'jesse' && c.isYou))
  })
})

describe('holdsSceneCurtain', () => {
  it('holds the curtain until the player raises it, even while connecting', () => {
    assert.equal(holdsSceneCurtain({ connectionState: 'idle', curtainRaised: false, hasLiveSession: false }), true)
    assert.equal(holdsSceneCurtain({ connectionState: 'connecting', curtainRaised: true, hasLiveSession: false }), true)
    assert.equal(holdsSceneCurtain({ connectionState: 'streaming', curtainRaised: true, hasLiveSession: true }), false)
    assert.equal(holdsSceneCurtain({ connectionState: 'beat_paused', curtainRaised: true, hasLiveSession: true }), false)
  })

  it('does not hold a resumed session hostage behind the billboard', () => {
    assert.equal(
      holdsSceneCurtain({ connectionState: 'beat_paused', curtainRaised: false, hasLiveSession: true }),
      false,
    )
  })
})
