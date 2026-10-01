import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crewRevealDelay, revealCrewReplies } from './crewReveal.ts'

type Reply = { sender: string; text: string }

function harness() {
  const log: string[] = []
  return {
    log,
    append: (r: Reply) => log.push(`show:${r.sender}`),
    setTyping: (who: string | null) => log.push(`typing:${who ?? '-'}`),
    wait: async (ms: number) => { log.push(`wait:${ms > 0 ? 'yes' : 'no'}`) },
  }
}

test('the lead shows at once; the second person types first, then appears', async () => {
  const h = harness()
  await revealCrewReplies<Reply>(
    [{ sender: 'jesse', text: '我在家。' }, { sender: 'hank', text: '……在家？' }],
    { ...h, senderOf: (r) => r.sender },
  )
  assert.deepEqual(h.log, ['show:jesse', 'typing:hank', 'wait:yes', 'typing:-', 'show:hank'])
})

test('a single reply has no typing pause', async () => {
  const h = harness()
  await revealCrewReplies<Reply>([{ sender: 'mike', text: '说。' }], { ...h, senderOf: (r) => r.sender })
  assert.deepEqual(h.log, ['show:mike'])
})

test('an aborted reveal still shows everything that was already paid for', async () => {
  const h = harness()
  const controller = new AbortController()
  controller.abort()
  await revealCrewReplies<Reply>(
    [{ sender: 'walter', text: '说。' }, { sender: 'skyler', text: '你说清楚。' }],
    { ...h, senderOf: (r) => r.sender, signal: controller.signal },
  )
  assert.deepEqual(h.log.filter((l) => l.startsWith('show:')), ['show:walter', 'show:skyler'])
  assert.ok(h.log.includes('typing:-'), 'typing indicator is cleared')
  assert.ok(!h.log.some((l) => l.startsWith('wait:')), 'no pause after an abort')
})

test('the pause is short and grows a little with the line, never a long wait', () => {
  assert.ok(crewRevealDelay('……') >= 600)
  assert.ok(crewRevealDelay('x'.repeat(500)) <= 1800)
  assert.ok(crewRevealDelay('x'.repeat(60)) > crewRevealDelay('x'))
})
