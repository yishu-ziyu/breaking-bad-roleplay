import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PlayerView } from './types.ts'
import { NightPlayView } from './GameScreen.tsx'
import { NightStartCta } from './NightStartCta.tsx'
import { sanitizePlayerView } from './eventReducer.ts'
import { observedPressure } from './playerDisplay.ts'

function view(partial: Partial<PlayerView> = {}): PlayerView {
  return {
    run_id: 'night-1',
    revision: 0,
    turn: 1,
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
    known: [],
    scene: { speaker: '杰西', body: '厨房门没关严。杰西站在台阶上，包还挎着。' },
    last_consequence: '',
    legal_actions: [
      { id: 'listen_jesse', label: '留下来听杰西说完', cost_text: '消耗本回合；回家的承诺更接近到期' },
      { id: 'go_home', label: '立刻回家兑现承诺', cost_text: '放弃此刻和杰西当面把话说清' },
      { id: 'call_saul', label: '请索尔代为协调', cost_text: '消耗一次人情；你欠他一个随后要还的忙' },
    ],
    ending: null,
    ...partial,
  }
}

test('night screen follows the player-visible hierarchy and prices actions', () => {
  const html = renderToStaticMarkup(
    createElement(NightPlayView, {
      view: view(),
      pending: false,
      error: null,
      skipMotion: false,
      muteVoice: true,
      mediaFailed: false,
      historyOpen: false,
      onChoose: () => {},
      onRestart: () => {},
      onSkipMotion: () => {},
      onMuteVoice: () => {},
      onMediaFail: () => {},
      onToggleHistory: () => {},
    }),
  )
  assert.match(html, /第 1 \/ 6 回合/)
  assert.match(html, /厨房/)
  assert.match(html, /你扮演 沃尔特/)
  assert.match(html, /当前目标/)
  assert.match(html, /即将到期的承诺/)
  assert.match(html, /你答应过斯凯勒今晚回家/)
  assert.match(html, /压力/)
  assert.match(html, /资源/)
  assert.match(html, /现金/)
  assert.match(html, /杰西/)
  assert.match(html, /厨房门没关严/)
  assert.match(html, /留下来听杰西说完/)
  assert.match(html, /消耗本回合；回家的承诺更接近到期/)
  assert.match(html, /请索尔代为协调/)
  assert.doesNotMatch(html, /上一步后果/)
  assert.doesNotMatch(html, /inner_monologue|npc_intent|thinking/)
})

test('pressure is observed wording, not a strategy meter', () => {
  const lines = observedPressure({ police_risk: 1, family_strain: 2, jesse_trust: 3 })
  assert.ok(lines.length >= 1)
  assert.ok(lines.every((line) => !/\d/.test(line)))
  const html = renderToStaticMarkup(
    createElement(NightPlayView, {
      view: view({ meters: { police_risk: 5, family_strain: 1, jesse_trust: 1 } }),
      pending: false,
      error: null,
      skipMotion: true,
      muteVoice: true,
      mediaFailed: true,
      historyOpen: false,
      onChoose: () => {},
      onRestart: () => {},
      onSkipMotion: () => {},
      onMuteVoice: () => {},
      onMediaFail: () => {},
      onToggleHistory: () => {},
    }),
  )
  assert.doesNotMatch(html, /police_risk|family_strain|jesse_trust/)
  assert.match(html, /跳过动画/)
  assert.match(html, /静音/)
})

test('media failure still leaves priced actions pressable', () => {
  const html = renderToStaticMarkup(
    createElement(NightPlayView, {
      view: view(),
      pending: false,
      error: null,
      skipMotion: true,
      muteVoice: true,
      mediaFailed: true,
      historyOpen: false,
      onChoose: () => {},
      onRestart: () => {},
      onSkipMotion: () => {},
      onMuteVoice: () => {},
      onMediaFail: () => {},
      onToggleHistory: () => {},
    }),
  )
  assert.match(html, /<button[^>]*class="night-action"/)
  assert.doesNotMatch(html, /<button[^>]*class="night-action"[^>]*disabled/)
})

test('home CTA is 开始这一夜 and keeps Direct/Crew experimental', () => {
  const html = renderToStaticMarkup(createElement(NightStartCta))
  assert.match(html, /开始这一夜/)
  assert.match(html, /\?night=1/)
})

test('play path talks to the night API, not the in-browser kernel', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const hook = readFileSync(join(here, 'useGameRun.ts'), 'utf8')
  assert.ok(hook.includes("from './api.ts'"))
  assert.equal(hook.includes('createLocalGame'), false)
  assert.equal(hook.includes("from './kernel"), false)
  assert.match(hook, /cancelled/)
  assert.match(readFileSync(join(here, 'api.ts'), 'utf8'), /inflight/)
})

test('经过 lists causes and costs, never NPC inner speech', () => {
  const html = renderToStaticMarkup(
    createElement(NightPlayView, {
      view: sanitizePlayerView(
        view({
          legal_actions: [{ id: 'stall', label: '再拖一回合', cost_text: '局面不会等人' }],
          history: [
            {
              turn: 1,
              source: 'player',
              action_id: 'listen_jesse',
              label: '留下来听杰西说完',
              cost_text: '消耗本回合；回家的承诺更接近到期',
              text: '你把门关上，听他把话说完。',
            },
            {
              turn: 1,
              source: 'thought',
              action_id: null,
              label: '',
              cost_text: '',
              text: '（内心：把你卖了）',
            },
          ],
        }),
      ),
      pending: false,
      error: null,
      skipMotion: true,
      muteVoice: true,
      mediaFailed: true,
      historyOpen: true,
      onChoose: () => {},
      onRestart: () => {},
      onSkipMotion: () => {},
      onMuteVoice: () => {},
      onMediaFail: () => {},
      onToggleHistory: () => {},
    }),
  )
  assert.match(html, /留下来听杰西说完/)
  assert.match(html, /消耗本回合；回家的承诺更接近到期/)
  assert.match(html, /你把门关上/)
  assert.doesNotMatch(html, /把你卖了|inner_monologue|npc_intent/)
})

test('recap keeps the six-turn trace and offers 回看 / 重演 / 分支', () => {
  const html = renderToStaticMarkup(
    createElement(NightPlayView, {
      view: view({
        turn: 6,
        ending: {
          id: 'held_the_line',
          title: '这条线还在',
          body: '你听完杰西，也回了家。',
          causes: [
            { turn: 1, action_id: 'listen_jesse', label: '留下来听杰西说完' },
            { turn: 2, action_id: 'stash_the_bag', label: '用现金把那包东西挪走' },
            { turn: 3, action_id: 'go_home', label: '立刻回家兑现承诺' },
            { turn: 4, action_id: 'stall', label: '再拖一回合' },
            { turn: 5, action_id: 'stall', label: '再拖一回合' },
            { turn: 6, action_id: 'stall', label: '再拖一回合' },
          ],
        },
        history: [
          {
            turn: 1,
            source: 'player',
            action_id: 'listen_jesse',
            label: '留下来听杰西说完',
            cost_text: '消耗本回合；回家的承诺更接近到期',
            text: '你把门关上，听他把话说完。',
          },
        ],
      }),
      pending: false,
      error: null,
      skipMotion: true,
      muteVoice: true,
      mediaFailed: true,
      historyOpen: false,
      onChoose: () => {},
      onRestart: () => {},
      onSkipMotion: () => {},
      onMuteVoice: () => {},
      onMediaFail: () => {},
      onToggleHistory: () => {},
      onReview: () => {},
      onReplay: () => {},
      onBranch: () => {},
    }),
  )
  assert.match(html, /第 1 回合：留下来听杰西说完/)
  assert.match(html, /消耗本回合；回家的承诺更接近到期/)
  assert.match(html, /回看/)
  assert.match(html, /重演/)
  assert.match(html, /分支/)
})
