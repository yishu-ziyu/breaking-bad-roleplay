import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bubbleFromDirectPayload, bubblesFromCrewPayload } from './directChatReply.ts'

describe('directChatReply', () => {
  it('maps a Direct payload onto one character bubble', () => {
    const bubble = bubbleFromDirectPayload('walter', {
      reply_text: 'Sit down.',
      emotion_state: 'tense',
      gif_search_query: 'walter white tense',
      thinking: 'He is testing me.',
      tool_executed: null,
      tool_log: null,
    })
    assert.equal(bubble.sender, 'walter')
    assert.equal(bubble.text, 'Sit down.')
    assert.equal(bubble.emotion, 'tense')
    assert.equal(bubble.thinking, 'He is testing me.')
    assert.ok(bubble.gifUrl)
  })

  it('maps crew debate_logs; empty logs with no reply_text stay empty', () => {
    const logs = bubblesFromCrewPayload('walter', {
      debate_logs: [
        { sender: 'jesse', text: 'Yo.', emotion: 'panic', gifQuery: null },
      ],
    })
    assert.equal(logs.length, 1)
    assert.equal(logs[0].sender, 'jesse')
    assert.equal(bubblesFromCrewPayload('walter', { debate_logs: [] }).length, 0)
  })
})
