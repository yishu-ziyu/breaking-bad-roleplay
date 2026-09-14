import assert from 'node:assert/strict'
import test from 'node:test'
import { applyBeat, reduceView, sanitizePlayerView, type DisplayView } from './eventReducer.ts'

function view(partial: Partial<DisplayView> = {}): DisplayView {
  return {
    run_id: 'night-1',
    revision: 1,
    turn: 2,
    turns_max: 6,
    location: 'kitchen',
    location_label: '厨房',
    player: '沃尔特',
    objective: '今晚结束前处理眼前冲突，同时保住关键关系',
    meters: { police_risk: 1, family_strain: 2, jesse_trust: 3 },
    resources: { cash: 2, saul_favor: 1 },
    promises: [
      {
        id: 'home_tonight',
        label: '你答应过斯凯勒今晚回家',
        due_turn: 4,
        source_action_id: null,
      },
    ],
    known: ['hot_bag'],
    scene: { speaker: '杰西', body: '包是烫的。他要你今晚别把他丢在门外。' },
    last_consequence: '你把门关上，听他把话说完。',
    legal_actions: [
      { id: 'stash_the_bag', label: '用现金把那包东西挪走', cost_text: '现金 -1' },
      { id: 'go_home', label: '立刻回家兑现承诺', cost_text: '放弃此刻把话说清' },
    ],
    ending: null,
    source_action_id: 'act-listen-1',
    visibility: 'player',
    ...partial,
  }
}

test('late event with older revision does not overwrite the current beat', () => {
  const current = view({ revision: 2, turn: 3, scene: { speaker: '杰西', body: '然后呢？' } })
  const late = view({
    revision: 1,
    turn: 2,
    source_action_id: 'act-listen-1',
    scene: { speaker: '杰西', body: '过期的场面不该回来' },
    last_consequence: '过期后果',
  })
  const next = applyBeat(current, {
    run_id: late.run_id,
    action_id: 'act-listen-1',
    revision: 1,
    view: late,
  })
  assert.equal(next.scene.body, '然后呢？')
  assert.equal(next.revision, 2)
  assert.equal(next.last_consequence, current.last_consequence)
})

test('late event from another run_id is ignored', () => {
  const current = view()
  const other = view({
    run_id: 'night-other',
    revision: 9,
    scene: { speaker: '索尔', body: '另一局的台词' },
  })
  const next = applyBeat(current, {
    run_id: 'night-other',
    action_id: 'act-x',
    revision: 9,
    view: other,
  })
  assert.equal(next.scene.speaker, '杰西')
  assert.equal(next.run_id, 'night-1')
})

test('same revision with a different action_id does not clobber the current beat', () => {
  const current = view({ revision: 1, source_action_id: 'act-listen-1' })
  const staleTwin = view({
    revision: 1,
    source_action_id: 'act-go-home-old',
    scene: { speaker: '斯凯勒', body: '迟到的回家场面' },
  })
  const next = applyBeat(current, {
    run_id: current.run_id,
    action_id: 'act-go-home-old',
    revision: 1,
    view: staleTwin,
  })
  assert.equal(next.scene.speaker, '杰西')
  assert.equal(next.source_action_id, 'act-listen-1')
})

test('newer revision with matching run_id replaces the beat', () => {
  const current = view({ revision: 1 })
  const newer = view({
    revision: 2,
    turn: 3,
    source_action_id: 'act-stash-2',
    scene: { speaker: '杰西', body: '包不在桌上了。' },
    last_consequence: '你用现金换人把包挪走。',
  })
  const next = applyBeat(current, {
    run_id: newer.run_id,
    action_id: 'act-stash-2',
    revision: 2,
    view: newer,
  })
  assert.equal(next.revision, 2)
  assert.equal(next.scene.body, '包不在桌上了。')
  assert.equal(next.source_action_id, 'act-stash-2')
})

test('info-gap: player view never keeps NPC inner monologue or private intent', () => {
  const dirty = view({
    scene: {
      speaker: '杰西',
      body: '包是烫的。（内心：我其实想把你卖了）他要你别关门。',
    },
  }) as DisplayView & {
    inner_monologue?: string
    thinking?: string
    npc_intent?: string
  }
  dirty.inner_monologue = '他其实准备跑路'
  dirty.thinking = 'I should dump the bag and leave Walt'
  dirty.npc_intent = 'betray_walter'
  const clean = sanitizePlayerView(dirty)
  const blob = JSON.stringify(clean)
  assert.equal(clean.scene.body.includes('内心'), false)
  assert.doesNotMatch(blob, /他其实准备跑路/)
  assert.doesNotMatch(blob, /dump the bag/)
  assert.doesNotMatch(blob, /betray_walter/)
  assert.doesNotMatch(blob, /inner_monologue/)
  assert.doesNotMatch(blob, /npc_intent/)
  assert.match(clean.scene.body, /包是烫的/)
})

test('reduceView still accepts a wholesale next view when there is no previous beat', () => {
  const opening = view({ revision: 0, turn: 1, last_consequence: '', source_action_id: null })
  const next = reduceView(null, opening)
  assert.equal(next.turn, 1)
  assert.equal(next.player, '沃尔特')
})

test('player history keeps action label and cost, drops inner speech', () => {
  const dirty = view({
    history: [
      {
        turn: 1,
        source: 'player',
        action_id: 'listen_jesse',
        label: '留下来听杰西说完',
        cost_text: '消耗本回合；回家的承诺更接近到期',
        text: '你把门关上。（内心：把包丢了）',
      },
      { turn: 1, source: 'thought', text: '秘密打算', action_id: null },
    ],
  })
  const clean = sanitizePlayerView(dirty)
  assert.equal(clean.history?.length, 1)
  assert.equal(clean.history?.[0]?.label, '留下来听杰西说完')
  assert.equal(clean.history?.[0]?.cost_text, '消耗本回合；回家的承诺更接近到期')
  assert.equal(clean.history?.[0]?.text.includes('内心'), false)
  assert.doesNotMatch(JSON.stringify(clean.history), /秘密打算|把包丢了/)
})
