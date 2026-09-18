/* SDD: story start must classify a failed POST /api/session/create into a
 * user-facing failure instead of leaking raw text (or "[object Object]"). */

import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createStorySession, sessionFailureFromStart } from './storySessionStart'

const realFetch = globalThis.fetch

type FetchCall = { url: string; body: Record<string, unknown> | null }

function stubFetch(status: number, payload: unknown): { calls: FetchCall[] } {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
    })
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return { calls }
}

afterEach(() => {
  globalThis.fetch = realFetch
})

test('a 500 from /api/session/create becomes a session_create failure with a readable detail', async () => {
  stubFetch(500, { detail: 'Internal Server Error' })
  const result = await createStorySession({
    taskPrompt: 'Walter needs a new supply before dawn.',
    characterId: 'walter',
    language: 'zh',
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.deepEqual(sessionFailureFromStart(result), {
    kind: 'session_create',
    status: 500,
    detail: 'Internal Server Error',
  })
})

test('an object-shaped detail is read as its message, never as "[object Object]"', async () => {
  stubFetch(500, { detail: { code: 'db_missing_migration', message: 'relation "sessions" does not exist' } })
  const result = await createStorySession({
    taskPrompt: 'Same opening.',
    characterId: 'jesse',
    language: 'zh',
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  const failure = sessionFailureFromStart(result)
  assert.equal(failure.detail, 'relation "sessions" does not exist')
  assert.doesNotMatch(String(failure.detail), /\[object Object\]/)
})

test('a successful create returns the session the stream needs, with no failure', async () => {
  const { calls } = stubFetch(200, {
    session_id: 'sid-1',
    session_key: 'skey-1',
    runtime_version: 1,
    world_revision: 4,
    command_id: 'cmd-1',
  })
  const result = await createStorySession({
    taskPrompt: '  Opening line.  ',
    characterId: 'walter',
    language: 'zh',
    scenarioId: 'desert_crisis',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.sessionId, 'sid-1')
  assert.equal(result.sessionKey, 'skey-1')
  assert.equal(result.runtimeVersion, 1)
  assert.equal(result.worldRevision, 4)
  assert.equal(result.commandId, 'cmd-1')
  assert.equal(sessionFailureFromStart(result), null)
  assert.equal(calls[0].url, '/api/session/create')
  assert.deepEqual(calls[0].body, {
    title: '  Opening line.  '.slice(0, 80),
    task_prompt: '  Opening line.  ',
    active_character_id: 'walter',
    language: 'zh',
    scenario_id: 'desert_crisis',
  })
})

test('a network failure is classified without an HTTP status', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch')
  }) as typeof fetch
  const result = await createStorySession({
    taskPrompt: 'Opening.',
    characterId: 'walter',
    language: 'zh',
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  const failure = sessionFailureFromStart(result)
  assert.equal(failure.kind, 'session_create')
  assert.equal(failure.status, null)
  assert.equal(failure.detail, 'Failed to fetch')
})
