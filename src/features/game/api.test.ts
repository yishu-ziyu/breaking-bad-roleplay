import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { startGame } from './api.ts'

const originalFetch = globalThis.fetch

function view(runId: string) {
  return {
    run_id: runId,
    revision: 0,
    turn: 1,
    turns_max: 6,
    location: 'kitchen',
    location_label: '厨房',
    player: '沃尔特',
    objective: '今晚结束前处理眼前冲突，同时保住关键关系',
    meters: {},
    resources: {},
    promises: [],
    known: [],
    scene: { speaker: '杰西', body: '厨房门没关严。' },
    last_consequence: '',
    legal_actions: [],
    ending: null,
    history: [],
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('overlapping startGame calls share one POST and one run', async () => {
  let posts = 0
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, 'POST')
    posts += 1
    await new Promise((resolve) => setTimeout(resolve, 30))
    return { ok: true, json: async () => view('run-once') } as Response
  }) as typeof fetch

  const [a, b] = await Promise.all([startGame(1), startGame(1)])
  assert.equal(posts, 1)
  assert.equal(a.run_id, 'run-once')
  assert.equal(b.run_id, 'run-once')
})

test('a later start after the first finishes opens a new run', async () => {
  const ids = ['run-a', 'run-b']
  globalThis.fetch = (async () => {
    const id = ids.shift()
    return { ok: true, json: async () => view(id ?? 'run-extra') } as Response
  }) as typeof fetch

  const first = await startGame(1)
  const second = await startGame(1, { force: true })
  assert.equal(first.run_id, 'run-a')
  assert.equal(second.run_id, 'run-b')
})
