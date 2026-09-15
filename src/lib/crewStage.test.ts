import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultCrewIds,
  getCrewFrame,
  getCrewOpener,
  getCrewPlaceholder,
  getCrewWayfinders,
} from './crewStage.ts'

describe('crew stage', () => {
  it('puts the selected person first and fills two more so the room is not a solo', () => {
    assert.deepEqual(defaultCrewIds('walter'), ['walter', 'jesse', 'saul'])
    assert.deepEqual(defaultCrewIds('jesse'), ['jesse', 'walter', 'saul'])
    assert.deepEqual(defaultCrewIds('saul'), ['saul', 'walter', 'jesse'])
  })

  it('opening copy talks about a room, not one-to-one Walter', () => {
    assert.match(getCrewOpener('zh'), /几个人/)
    assert.match(getCrewFrame('zh'), /几个人/)
    assert.match(getCrewPlaceholder('zh'), /在场/)
    assert.doesNotMatch(getCrewOpener('zh'), /说话谨慎一点/)
    assert.doesNotMatch(getCrewFrame('zh'), /扮演这一角/)
  })

  it('wayfinders address the room and name other people', () => {
    const zh = getCrewWayfinders('zh').join('\n')
    assert.match(zh, /杰西/)
    assert.match(zh, /索尔/)
    assert.doesNotMatch(zh, /我需要你的建议|你最近怎么样/)
    assert.doesNotMatch(zh, /汉克今晚要来吃饭/)
  })
})
