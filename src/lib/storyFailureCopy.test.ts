/* SDD: player-facing story notices must follow the interface language.
 *
 * A Chinese interface must never show the old hard-coded English toast, and a
 * failed resume must classify into the same plain-copy card as the T2 failures
 * (`Failed to restore story state (500)` stays a debug detail, not the line the
 * player reads). */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storyFailureCopy, storyResumeNoticeCopy } from './storyFailureCopy'

test('the expired-session toast follows the UI language', () => {
  const zh = storyResumeNoticeCopy('expired', 'zh')
  assert.match(zh, /[\u4e00-\u9fa5]/, 'zh copy must be Chinese')
  assert.doesNotMatch(zh, /Your last session expired/, 'no hard-coded English in the zh interface')

  const en = storyResumeNoticeCopy('expired', 'en')
  assert.match(en, /expired/i, 'en copy still says what happened')
  assert.match(en, /start a new one/i, 'en copy keeps the next step')
})

test('the unverified-session toast follows the UI language', () => {
  const zh = storyResumeNoticeCopy('unverified', 'zh')
  assert.match(zh, /[\u4e00-\u9fa5]/, 'zh copy must be Chinese')
  assert.doesNotMatch(zh, /Could not verify your last session/, 'no hard-coded English in the zh interface')
  assert.match(zh, /重试|再试|恢复/, 'zh copy must tell the player the next step')

  const en = storyResumeNoticeCopy('unverified', 'en')
  assert.match(en, /verify/i)
  assert.match(en, /reachable/i)
})

test('resume notices default to Chinese for an unset/unknown language', () => {
  assert.equal(storyResumeNoticeCopy('expired', null), storyResumeNoticeCopy('expired', 'zh'))
  assert.equal(storyResumeNoticeCopy('expired', undefined), storyResumeNoticeCopy('expired', 'zh'))
  assert.equal(storyResumeNoticeCopy('expired', 'fr'), storyResumeNoticeCopy('expired', 'zh'))
})

test('a failed resume gets the same plain failure copy in both languages', () => {
  const zh = storyFailureCopy({ kind: 'resume_failed' }, 'zh')
  assert.match(zh.headline, /[\u4e00-\u9fa5]/)
  assert.match(zh.body, /[\u4e00-\u9fa5]/)
  assert.match(zh.retryLabel, /重试/)
  assert.doesNotMatch(zh.body, /Failed to restore|500|session/i)

  const en = storyFailureCopy({ kind: 'resume_failed' }, 'en')
  assert.match(en.headline, /story/i)
  assert.match(en.retryLabel, /Retry/)
})
