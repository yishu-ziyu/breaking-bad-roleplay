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
    assert.equal(bill.startLabel, '开始故事')
    assert.doesNotMatch(bill.episodeTitle, /这一夜|This night|gacha|抽卡|卡牌/i)
  })

  it('puts Saul on stage when the crisis is the phone call', () => {
    const bill = buildStorySceneBill({
      choiceId: 'call_saul',
      characterId: 'walter',
      language: 'en',
      knowledgeTrack: 'fan',
    })
    assert.ok(bill.onStage.some((c) => c.id === 'saul'))
    assert.equal(bill.startLabel, 'Start Story')
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

  it('brief-start (free) does not title the scene as 这一夜', () => {
    const bill = buildStorySceneBill({
      choiceId: 'free',
      characterId: 'walter',
      language: 'zh',
      knowledgeTrack: 'fan',
    })
    assert.equal(bill.episodeTitle, '')
    assert.doesNotMatch(bill.episodeTitle, /这一夜|自己决定/)
    assert.doesNotMatch(bill.crisis, /没有规定动作|这一夜/)
    assert.match(bill.crisis, /杰西|车灯/)
    assert.equal(bill.startLabel, '开始故事')
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
