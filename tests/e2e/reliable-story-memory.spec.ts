import { test, expect, type Page } from '@playwright/test'

type Event = { type: string; data: Record<string, unknown> }

async function seed(page: Page, surface: 'story' | 'direct') {
  await page.addInitScript((mode) => {
    if (sessionStorage.getItem('p0-seeded')) return
    localStorage.clear()
    for (const [key, value] of Object.entries({
      enteredWorld: true, productSurface: 'v3-mode-door', knowledgeTrack: 'fan',
      character: 'walter', language: 'zh', surface: mode,
    })) localStorage.setItem(`abq_${key}`, JSON.stringify(value))
    // T10: a stored Story surface is reclaimed for visitors on load, so the
    // story cases below opt in as authors. The Direct case keeps its surface
    // as a visitor.
    if (mode === 'story') localStorage.setItem('yishu_authoring_mode', '1')
    sessionStorage.setItem('p0-seeded', 'yes')
  }, surface)
}

function eventsFor(
  command: string,
  revision: number,
  final = false,
  action?: Record<string, unknown>,
): Event[] {
  const events: Event[] = [
    ...(action?.player_input ? [{
      type: 'player_turn',
      data: {
        kind: String(action.player_kind || 'free'),
        content: String(action.player_input),
      },
    }] : []),
    ...(revision === 1 ? [{
      type: 'outline',
      data: { content: '1. 房车旁的争执\n2. 手机交接的后果' },
    }] : []),
    { type: 'scene_change', data: { from_scene: 'desert', to_scene: 'desert', description: revision === 1 ? '房车停在荒漠里。' : '手机已经交到杰西手里。' } },
    { type: 'agent_speak', data: { character_id: 'Jesse Pinkman', content: revision === 1 ? '先把话说清楚。' : '好，我拿着。', emotion_state: 'tense' } },
    { type: 'beat_ready', data: { world_revision: revision, beat_id: `beat_${revision}`, is_final: final, player_actor_id: 'walter' } },
  ]
  return events.map((event, index) => ({
    ...event,
    data: {
      ...event.data,
      event_id: `${command}:${index}`,
      command_id: command,
      beat_id: `beat_${revision}`,
    },
  }))
}

async function installApi(page: Page, options: {
  loseFirstAck?: boolean
  resumePending?: boolean
  /** The acknowledgement is lost AND the server never recorded the command. */
  loseAckWithoutRecording?: boolean
} = {}) {
  let revision = options.resumePending ? 1 : 0
  let command = options.resumePending ? 'pending-resume' : 'opening'
  let pending: string | null = options.resumePending ? command : null
  let loseAck = !!options.loseFirstAck || !!options.loseAckWithoutRecording
  const severAck = !!options.loseAckWithoutRecording
  const batches = new Map<string, Event[]>()
  const commandBodies = new Map<string, Record<string, unknown>>()
  if (options.resumePending) {
    batches.set('opening', eventsFor('opening', 1))
    commandBodies.set('pending-resume', {
      action: 'act',
      player_input: '把手机交给杰西',
      player_kind: 'do',
    })
  }
  const actions: Array<Record<string, unknown>> = []
  const chats: Array<Record<string, unknown>> = []
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    let value: unknown = {}
    if (url.pathname.endsWith('/connections/catalog')) value = {
      platform: { minimax: true, stepfun: true }, defaults: { providerId: 'stepfun', modelId: 'step-3.7-flash' },
    }
    else if (url.pathname.endsWith('/quota')) value = { open: true, byok: false, remaining: 100, limit: 100, used: 0 }
    else if (url.pathname.endsWith('/session/create')) value = {
      session_id: 'p0-story', session_key: 'p0-key', runtime_version: 1,
      world_revision: 0, command_id: 'opening',
    }
    else if (url.pathname.endsWith('/action')) {
      const body = route.request().postDataJSON() as Record<string, unknown>
      actions.push(body)
      const requested = body.action === 'replay' ? [...batches.keys()].at(-1)! : String(body.command_id)
      if (body.action !== 'replay' && !severAck) command = requested
      if (body.action !== 'replay') {
        pending = severAck ? null : requested
        commandBodies.set(requested, body)
      }
      if (loseAck) {
        loseAck = false
        await route.abort('failed')
        return
      }
      value = { status: 'ok', runtime_version: 1, command_id: requested, world_revision: revision }
    }
    else if (url.pathname.endsWith('/stream')) {
      const requested = url.searchParams.get('command_id') || command
      if (!batches.has(requested)) {
        batches.set(requested, eventsFor(requested, ++revision, false, commandBodies.get(requested)))
      }
      if (requested === pending) pending = null
      const wire = batches.get(requested)!.map((event) =>
        `id: ${event.data.event_id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      ).join('')
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: wire })
      return
    }
    else if (url.pathname.endsWith('/state')) value = {
      runtime_version: 1, world_revision: revision, status: 'waiting', command_id: command,
      pending_command_id: pending,
      outline: '1. 房车旁的争执\n2. 手机交接的后果',
      player_actor_id: 'walter',
      world: { player_id: 'walter' },
      events: [...batches.values()].flat(),
    }
    else if (url.pathname.endsWith('/messages')) value = []
    else if (url.pathname.endsWith('/chat')) {
      chats.push(route.request().postDataJSON())
      value = { reply_text: '明天再说。别让其他人知道。', emotion_state: 'tense', thinking: null }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
  })
  return { actions, chats }
}

test('refresh resumes a pending committed command instead of asking the player to resubmit', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('abq_story_session_id', 'p0-story')
    localStorage.setItem('abq_story_session_key', 'p0-key')
    localStorage.setItem('abq_enteredWorld', JSON.stringify(true))
    localStorage.setItem('abq_productSurface', JSON.stringify('v3-mode-door'))
    localStorage.setItem('abq_knowledgeTrack', JSON.stringify('fan'))
    localStorage.setItem('abq_character', JSON.stringify('walter'))
    localStorage.setItem('abq_language', JSON.stringify('zh'))
    localStorage.setItem('abq_surface', JSON.stringify('story'))
    // T10: author opt-in, or the stored Story surface is reclaimed pre-paint.
    localStorage.setItem('yishu_authoring_mode', '1')
  })
  await installApi(page, { resumePending: true })
  await page.goto('/')
  await expect(page.locator('.story-manuscript')).toContainText('手机已经交到杰西手里。')
  await expect(page.locator('.story-manuscript__player')).toContainText('把手机交给杰西')
  await expect(page.locator('.beat-paused--drama')).toBeVisible()
})

async function startStory(page: Page) {
  await seed(page, 'story')
  await page.goto('/')
  await expect(page.locator('.story-setup textarea')).toBeVisible()
  await page.locator('.story-setup textarea').fill('你在房车旁和杰西说话。')
  await expect(page.locator('.story-setup button')).toBeEnabled()
  await page.locator('.story-setup button').click()
  await expect(page.locator('.beat-paused--drama')).toBeVisible()
  await expect(page.locator('.story-manuscript')).toContainText('先把话说清楚。')
}

test('Story uses stable action commands, restores the saved result and replays without duplicate text', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const api = await installApi(page)
  await startStory(page)
  await page.locator('.drama-decision input').fill('把手机交给杰西')
  await page.locator('.drama-decision button[type="submit"]').click()
  await expect(page.locator('.story-manuscript')).toContainText('手机已经交到杰西手里。')
  expect(api.actions[0]).toMatchObject({
    action: 'act',
    player_input: '把手机交给杰西',
    player_kind: 'free',
    expected_revision: 1,
  })
  expect(api.actions[0].command_id).toEqual(expect.any(String))
  expect(api.actions[0]).not.toHaveProperty('redirect_prompt')
  await page.reload()
  await expect(page.locator('.story-manuscript')).toContainText('手机已经交到杰西手里。')
  await expect(page.locator('.story-manuscript__player').filter({ hasText: '把手机交给杰西' })).toHaveCount(1)
  await page.getByRole('button', { name: '回看这一拍' }).click()
  await expect(page.locator('.story-manuscript__dialogue').filter({ hasText: '好，我拿着。' })).toHaveCount(1)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(errors).toEqual([])
  await page.screenshot({ path: '/tmp/abq-p0-story-desktop.png', fullPage: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.drama-decision')).toBeVisible()
  await page.screenshot({ path: '/tmp/abq-p0-story-mobile.png', fullPage: false })
})

test('an uncertain action acknowledgement resolves itself without a second command', async ({ page }) => {
  const api = await installApi(page, { loseFirstAck: true })
  await startStory(page)
  await page.locator('.drama-decision input').fill('把手机交给杰西')
  await page.locator('.drama-decision button[type="submit"]').click()
  // P0: the client re-asks /state with the SAME command id and connects to it.
  // The player never resubmits, so exactly one command exists.
  await expect(page.locator('.story-manuscript')).toContainText('手机已经交到杰西手里。')
  await expect(page.locator('.beat-paused--drama')).toBeVisible()
  expect(api.actions).toHaveLength(1)
  await expect(page.locator('.story-manuscript__player')).toHaveCount(1)
})

test('a command the server never received is re-sent with the same id', async ({ page }) => {
  const api = await installApi(page, { loseAckWithoutRecording: true })
  await startStory(page)
  await page.locator('.drama-decision input').fill('把手机交给杰西')
  await page.locator('.drama-decision button[type="submit"]').click()
  // /state proves the server has no such command, so the identical body (and
  // command id) is sent again — no retyping, no second logical move.
  await expect(page.locator('.story-manuscript')).toContainText('手机已经交到杰西手里。')
  expect(api.actions).toHaveLength(2)
  expect(api.actions[1]).toEqual(api.actions[0])
  await expect(page.locator('.story-manuscript__player')).toHaveCount(1)
})

test('Direct retains Chinese identity and a secret after a refresh', async ({ page }) => {
  const api = await installApi(page)
  await seed(page, 'direct')
  await page.goto('/?surface=direct')
  await page.locator('.composer textarea').fill('我叫小李，别告诉汉克，我们说好明天见。')
  await page.locator('.composer button[type="submit"]').click()
  await expect(page.locator('.chat-stream')).toContainText('明天再说。别让其他人知道。')
  await page.reload()
  await expect(page.locator('.chat-stream')).toContainText('我叫小李，别告诉汉克，我们说好明天见。')
  await expect(page.locator('.chat-stream')).toContainText('明天再说。别让其他人知道。')
  await page.locator('.composer textarea').fill('记得我们昨天说了什么吗？')
  await page.locator('.composer button[type="submit"]').click()
  await expect.poll(() => api.chats.length).toBe(2)
  const memory = String(api.chats[1].durableMemory)
  expect(memory).toContain('[player_fact]')
  expect(memory).toContain('[secret]')
  expect(memory).toContain('[agreement]')
  expect(memory).toContain('我叫小李')
  expect(memory.length).toBeLessThanOrEqual(2000)
  await page.screenshot({ path: '/tmp/abq-p0-direct-memory.png', fullPage: false })
})
