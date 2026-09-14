import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAction, fingerprint, playerView, startRun } from './kernel.ts'

const FAMILY_FIRST = ['go_home', 'call_jesse', 'stall', 'stall', 'stall', 'stall']
const LISTEN_FIRST = ['listen_jesse', 'stash_the_bag', 'go_home', 'stall', 'stall', 'stall']
const SAUL_DELAY = ['call_saul', 'listen_jesse', 'stash_the_bag', 'go_home', 'stall', 'stall']

function play(actions: string[], seed = 7) {
  let state = startRun(seed)
  const errors: string[] = []
  for (const actionId of actions) {
    const [next, err] = applyAction(state, actionId)
    if (err) errors.push(`${actionId}: ${err}`)
    else state = next
  }
  return { state, errors }
}

test('G1 same seed and six actions match', () => {
  const a = play(LISTEN_FIRST, 11)
  const b = play(LISTEN_FIRST, 11)
  assert.deepEqual(a.errors, [])
  assert.deepEqual(b.errors, [])
  assert.equal(fingerprint(a.state), fingerprint(b.state))
  assert.ok(a.state.ending)
  assert.equal(a.state.turn, 7)
})

test('G2 illegal action does not mutate; costs are visible', () => {
  const state = startRun(3)
  const before = fingerprint(state)
  const [next, err] = applyAction(state, 'teleport_to_mexico')
  assert.ok(err)
  assert.equal(fingerprint(next), before)
  const listen = playerView(state).legal_actions.find((a) => a.id === 'listen_jesse')
  assert.ok(listen?.cost_text)
})

test('G4 three strategies reach different endings with causes', () => {
  const family = play(FAMILY_FIRST)
  const listen = play(LISTEN_FIRST)
  const saul = play(SAUL_DELAY)
  assert.deepEqual(family.errors, [])
  assert.deepEqual(listen.errors, [])
  assert.deepEqual(saul.errors, [])
  const ids = new Set([family.state.ending?.id, listen.state.ending?.id, saul.state.ending?.id])
  assert.equal(ids.size, 3)
  assert.equal(family.state.ending?.id, 'family_over_jesse')
  assert.equal(listen.state.ending?.id, 'held_the_line')
  assert.equal(saul.state.ending?.id, 'bought_time')
  assert.ok((listen.state.ending?.causes.length ?? 0) > 0)
  assert.deepEqual(
    listen.state.ending?.causes.map((c) => c.turn),
    [1, 2, 3, 4, 5, 6],
  )
})

test('opening view names Walter, the night, and 2–3 priced actions', () => {
  const view = playerView(startRun(1))
  assert.equal(view.player, '沃尔特')
  assert.equal(view.turn, 1)
  assert.equal(view.turns_max, 6)
  assert.ok(view.legal_actions.length >= 2)
  assert.ok(view.legal_actions.length <= 3)
  assert.equal(view.ending, null)
})

test('player view history lists six actions with costs and ending still traces them', () => {
  const { state, errors } = play(LISTEN_FIRST, 11)
  assert.deepEqual(errors, [])
  const view = playerView(state)
  const players = (view.history ?? []).filter((item) => item.source === 'player')
  assert.deepEqual(
    players.map((item) => item.action_id),
    LISTEN_FIRST,
  )
  assert.ok(players.every((item) => Boolean(item.label) && Boolean(item.cost_text)))
  assert.match(players[0]?.cost_text ?? '', /消耗本回合|放弃|人情|现金|局面/)
  assert.doesNotMatch(JSON.stringify(view.history), /内心|inner_monologue|npc_intent/)
  assert.deepEqual(
    view.ending?.causes.map((cause) => cause.action_id),
    LISTEN_FIRST,
  )
})
