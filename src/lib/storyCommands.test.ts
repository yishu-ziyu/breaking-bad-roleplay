import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundedStoryDirection, buildStoryCommand } from './storyCommands.ts'

test('modern player actions are commands, never prompt redirects', () => {
  assert.deepEqual(buildStoryCommand('act', { player_input: '把手机交给杰西', player_kind: 'do' }, {
    runtimeVersion: 1, revision: 7, commandId: 'stable-id',
  }), {
    action: 'act',
    player_input: '把手机交给杰西',
    player_kind: 'do',
    expected_revision: 7,
    command_id: 'stable-id',
  })
})

test('same command envelope can be retried without changing its id or revision', () => {
  const options = { runtimeVersion: 1, revision: 2, commandId: 'retry-id' }
  const one = buildStoryCommand('continue', {}, options)
  const two = buildStoryCommand('continue', {}, options)
  assert.deepEqual(one, two)
})

test('legacy saves use the legacy wire format without pretending to have a ledger', () => {
  assert.deepEqual(buildStoryCommand('act', { player_input: 'Look around' }, {
    runtimeVersion: 0, revision: 0, commandId: 'unused',
  }), { action: 'redirect', redirect_prompt: 'Look around' })
})

test('chapter and branch directions stay inside the backend field limit', () => {
  const prefix = 'Continue the committed story. Preserve every consequence.'
  const context = `old context ${'x'.repeat(4000)} latest consequence`
  const direction = boundedStoryDirection(prefix, context)

  assert.ok(direction.length <= 1900)
  assert.ok(direction.startsWith(prefix))
  assert.ok(direction.endsWith('latest consequence'))
})
