import { test, expect, type Page, type Route } from '@playwright/test'

/* P0 network recovery. Everything here is deterministic: the mock server is
 * the one that decides when the old "generator" finally commits, whether an
 * action is refused, and which /state answer arrives late. */

type Event = { type: string; data: Record<string, unknown> }

const OPENING_LINE = '先把话说清楚。'
const ACTION_LINE = '好，我拿着。'
const FOREIGN_LINE = '把枪放下。'
const PLAYER_LINE = '把手机交给杰西'
const OTHER_LINE = '别开枪，我们谈条件'

function wire(command: string, revision: number, events: Event[]): Event[] {
  return [
    ...events,
    {
      type: 'beat_ready',
      data: {
        world_revision: revision,
        beat_id: `beat_${revision}`,
        is_final: false,
        player_actor_id: 'walter',
      },
    },
  ].map((event, index) => ({
    ...event,
    data: {
      ...event.data,
      event_id: `${command}:${index}`,
      command_id: command,
      beat_id: `beat_${revision}`,
    },
  }))
}

function sse(events: Event[]): string {
  return events
    .map((event) => `id: ${event.data.event_id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
}

async function seedStory(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('net-seeded')) return
    localStorage.clear()
    for (const [key, value] of Object.entries({
      enteredWorld: true, productSurface: 'v3-mode-door', knowledgeTrack: 'fan',
      character: 'walter', language: 'zh', surface: 'story',
    })) localStorage.setItem(`abq_${key}`, JSON.stringify(value))
    // T10: a stored Story surface is reclaimed for visitors on load. Every test
    // in this spec drives the Story board → opt in as an author.
    localStorage.setItem('yishu_authoring_mode', '1')
    sessionStorage.setItem('net-seeded', 'yes')
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function installRecoveryApi(page: Page, options: {
  loseFirstAck?: boolean
  loseAckWithoutRecording?: boolean
} = {}) {
  const state = {
    revision: 0,
    pending: 'opening' as string | null,
    last: 'opening',
    status: 'waiting',
    /* How many more stream attempts still answer 409 turn_in_progress.
     * Infinity models "stream A is still generating". */
    holds: 0,
    committed: new Set<string>(),
    batches: new Map<string, Event[]>(),
    bodies: new Map<string, Record<string, unknown>>(),
    actions: [] as Array<Record<string, unknown>>,
    stopCalls: 0,
    /** Commands whose beat was GENERATED (billed) by this response. */
    generated: [] as string[],
    /** Commands served from the committed outbox (free replay). */
    replayed: [] as string[],
    streamUrls: [] as string[],
    /** Every mocked request, in order: helps assert call shapes. */
    requestLog: [] as string[],
    conflicts: 0,
    stateProbes: 0,
    lostAck: !!options.loseFirstAck || !!options.loseAckWithoutRecording,
    severAck: !!options.loseAckWithoutRecording,
    /* knobs */
    delayStateMs: 0,
    stopFailures: 0,
    action502: 0,
    /** Hang the next N action POSTs: the request never answers. */
    actionHangs: 0,
    /** Fail the next N automatic resends (502 after the server recorded it). */
    resendFailures: 0,
    /** Delay the next automatic resend's answer (it is still in the air). */
    delayResendMs: 0,
    streamFailures: 0,
    emptyStreams: 0,
  }

  const commit = (command: string) => {
    state.revision += 1
    state.last = command
    state.pending = null
    state.committed.add(command)
    const body = state.bodies.get(command)
    const events: Event[] = []
    if (body && typeof body.player_input === 'string') {
      events.push({
        type: 'player_turn',
        data: { kind: String(body.player_kind || 'free'), content: String(body.player_input) },
      })
    }
    events.push({
      type: 'scene_change',
      data: {
        from_scene: 'desert', to_scene: 'desert',
        description: state.revision === 1 ? '房车停在荒漠里。' : '尘土落下去，事情已经变了。',
      },
    })
    events.push({
      type: 'agent_speak',
      data: {
        character_id: 'Jesse Pinkman',
        content: state.revision === 1 ? OPENING_LINE : ACTION_LINE,
      },
    })
    state.batches.set(command, wire(command, state.revision, events))
  }

  const json = (route: Route, value: unknown) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(value),
  })
  const conflict = (route: Route, code: string) => route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ detail: { code, world_revision: state.revision } }),
  })

  const installed = page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    state.requestLog.push(`${route.request().method()} ${path}${url.search}`)

    if (path.endsWith('/connections/catalog')) {
      return json(route, { platform: { minimax: true, stepfun: true }, defaults: { providerId: 'stepfun', modelId: 'step-3.7-flash' } })
    }
    if (path.endsWith('/quota')) {
      return json(route, { open: true, byok: false, remaining: 100, limit: 100, used: 0 })
    }
    if (path.endsWith('/session/create')) {
      state.pending = 'opening'
      return json(route, {
        session_id: 'net-story', session_key: 'net-key',
        runtime_version: 1, world_revision: 0, command_id: 'opening',
      })
    }
    if (path.endsWith('/action')) {
      const body = route.request().postDataJSON() as Record<string, unknown>
      state.actions.push(body)
      if (body.action === 'stop') {
        state.stopCalls += 1
        if (state.stopFailures > 0) {
          state.stopFailures -= 1
          await route.abort('failed')
          return
        }
        state.pending = null
        state.holds = 0
        state.status = 'stopped'
        return json(route, {
          status: 'ok', session_id: 'net-story', runtime_version: 1,
          world_revision: state.revision, command_id: state.last,
        })
      }
      const command = String(body.command_id)
      // A real enqueue_turn refuses a new command while another one is pending.
      if (state.pending && state.pending !== command) {
        state.conflicts += 1
        return conflict(route, 'turn_in_progress')
      }
      if (state.status === 'stopped') {
        return conflict(route, 'story_stopped')
      }
      const isResend = state.bodies.has(command)
      state.bodies.set(command, body)
      state.pending = command
      if (isResend && state.delayResendMs > 0) {
        const delay = state.delayResendMs
        state.delayResendMs = 0
        await sleep(delay)
      }
      if (isResend && state.resendFailures > 0) {
        // The server took the resent command, then failed to answer again.
        state.resendFailures -= 1
        return route.fulfill({
          status: 502, contentType: 'application/json',
          body: JSON.stringify({ detail: 'upstream failure' }),
        })
      }
      if (state.actionHangs > 0) {
        // The never-answering POST: the client must not wait forever.
        state.actionHangs -= 1
        await new Promise(() => { /* never resolves */ })
        return
      }
      if (state.action502 > 0) {
        // The server recorded the command, then failed to answer.
        state.action502 -= 1
        return route.fulfill({
          status: 502, contentType: 'application/json',
          body: JSON.stringify({ detail: 'upstream failure' }),
        })
      }
      if (state.lostAck) {
        // The server accepted it; the acknowledgement never reached the client.
        state.lostAck = false
        if (state.severAck) state.pending = null
        await route.abort('failed')
        return
      }
      return json(route, {
        status: 'ok', session_id: 'net-story', runtime_version: 1,
        command_id: command, world_revision: state.revision,
      })
    }
    if (path.endsWith('/stream')) {
      state.streamUrls.push(url.toString())
      const requested = url.searchParams.get('command_id') || state.pending || state.last
      if (state.streamFailures > 0) {
        state.streamFailures -= 1
        await route.abort('failed')
        return
      }
      if (state.emptyStreams > 0) {
        // A 200 that closes immediately, without a single event.
        state.emptyStreams -= 1
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
      }
      if (state.committed.has(requested)) {
        state.replayed.push(requested)
        return route.fulfill({
          status: 200, contentType: 'text/event-stream', body: sse(state.batches.get(requested)!),
        })
      }
      if (requested === state.pending) {
        if (state.holds > 0) {
          state.holds -= 1
          state.conflicts += 1
          if (state.holds === 0) {
            // "Stream A" finishes its own generation right after refusing us:
            // the next attempt must be served from the committed outbox.
            commit(requested)
            state.generated.push(requested)
          }
          return conflict(route, 'turn_in_progress')
        }
        commit(requested)
        state.generated.push(requested)
        return route.fulfill({
          status: 200, contentType: 'text/event-stream', body: sse(state.batches.get(requested)!),
        })
      }
      return conflict(route, 'not_pending')
    }
    if (path.endsWith('/state')) {
      state.stateProbes += 1
      if (state.delayStateMs > 0) {
        const delay = state.delayStateMs
        state.delayStateMs = 0
        await sleep(delay)
      }
      return json(route, {
        runtime_version: 1,
        world_revision: state.revision,
        status: state.status,
        pending_command_id: state.pending,
        command_id: state.pending || state.last,
        player_actor_id: 'walter',
        world: { player_id: 'walter' },
        events: [...state.committed].flatMap((command) => state.batches.get(command) ?? []),
      })
    }
    if (path.endsWith('/messages')) return json(route, [])
    return json(route, {})
  }).then(() => undefined)

  return {
    install: installed,
    state,
    setHolds: (n: number) => { state.holds = n },
    release: () => { state.holds = 0 },
    /** Another tab enqueued a command on this session. */
    plantPending: (command: string, playerInput: string) => {
      state.bodies.set(command, { action: 'act', player_input: playerInput, player_kind: 'free' })
      state.pending = command
      state.holds = 0
    },
    delayNextState: (ms: number) => { state.delayStateMs = ms },
    failNextStreams: (n: number) => { state.streamFailures = n },
    emptyNextStreams: (n: number) => { state.emptyStreams = n },
    failNextStops: (n: number) => { state.stopFailures = n },
    failNextActionWith502: () => { state.action502 = 1 },
    hangNextActions: (n: number) => { state.actionHangs = n },
    failNextResends: (n: number) => { state.resendFailures = n },
    delayNextResend: (ms: number) => { state.delayResendMs = ms },
  }
}

async function startStory(page: Page) {
  await page.goto('/')
  await expect(page.locator('.story-setup textarea')).toBeVisible()
  await page.locator('.story-setup textarea').fill('你在房车旁和杰西说话。')
  await expect(page.locator('.story-setup button')).toBeEnabled()
  await page.locator('.story-setup button').click()
  await expect(page.locator('.beat-paused--drama')).toBeVisible()
  await expect(page.locator('.story-manuscript')).toContainText(OPENING_LINE)
}

async function submitAction(page: Page, text: string) {
  await page.locator('.drama-decision input').fill(text)
  await page.locator('.drama-decision button[type="submit"]').click()
}

test('a reconnect that finds the old generator still running waits, then replays the committed beat', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page)
  await api.install

  await startStory(page)
  api.setHolds(2) // stream A still generates: the first two attempts answer 409
  await submitAction(page, PLAYER_LINE)

  // Third attempt: the same command is committed and replays from the outbox.
  await expect(page.locator('.story-manuscript')).toContainText(ACTION_LINE, { timeout: 20_000 })
  await expect(page.locator('.beat-paused--drama')).toBeVisible()

  expect(api.state.conflicts).toBe(2)
  expect(api.state.actions).toHaveLength(1)
  const command = String(api.state.actions[0].command_id)
  expect(api.state.actions[0]).toMatchObject({
    action: 'act', player_input: PLAYER_LINE, expected_revision: 1,
  })
  // Quota: the 409 attempts are never billed, the beat was generated once, and
  // the beat the client finally shows came from the committed outbox.
  expect(api.state.generated.filter((id) => id === command)).toHaveLength(1)
  expect(api.state.replayed).toContain(command)

  // No duplicate, no orphan, and no error page.
  await expect(page.locator('.story-manuscript__player')).toHaveCount(1)
  await expect(page.locator('.story-manuscript__player--pending')).toHaveCount(0)
  await expect(page.locator('.story-manuscript__dialogue').filter({ hasText: ACTION_LINE })).toHaveCount(1)
  await expect(page.locator('.story-manuscript__dialogue').filter({ hasText: OPENING_LINE })).toHaveCount(1)
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a lost action acknowledgement keeps the original move and refuses a different one', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page, { loseFirstAck: true })
  await api.install

  await startStory(page)
  api.setHolds(Number.POSITIVE_INFINITY) // stream A never finishes during the test
  await submitAction(page, PLAYER_LINE)
  await expect(page.locator('.story-manuscript__player--pending')).toHaveCount(1)
  await expect(page.locator('.beat-paused__notice')).toBeVisible()

  // The player thinks the move was lost and types something else.
  await submitAction(page, OTHER_LINE)
  await expect(page.locator('.beat-paused__notice')).toBeVisible()
  expect(api.state.actions).toHaveLength(1)
  // The pending move is still exactly one line, still marked as unconfirmed.
  await expect(page.locator('.story-manuscript__player--pending')).toHaveCount(1)
  await expect(page.locator('.story-manuscript__player')).toHaveCount(1)

  // The server finishes the original command.
  api.release()
  await expect(page.locator('.story-manuscript')).toContainText(ACTION_LINE, { timeout: 20_000 })

  await expect(page.locator('.story-manuscript__player')).toHaveCount(1)
  await expect(page.locator('.story-manuscript')).toContainText(PLAYER_LINE)
  await expect(page.locator('.story-manuscript')).not.toContainText(OTHER_LINE)
  await expect(page.locator('.story-manuscript__player--pending')).toHaveCount(0)
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(api.state.actions).toHaveLength(1)
  expect(api.state.stopCalls).toBe(0)
  expect(errors).toEqual([])
})

test('a manual reconnect that closes before any event retries instead of showing an error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page)
  await api.install

  await startStory(page)
  // Break the next two stream attempts at the transport level so the UI
  // reaches its interrupted state (one silent retry is already spent).
  api.failNextStreams(2)
  await page.locator('.beat-paused__advanced summary').click()
  await page.locator('.beat-controls button', { hasText: '继续' }).first().click()
  await expect(page.locator('.story-error')).toBeVisible()

  // Manual retry: the first response closes immediately without a single
  // event. That must NOT pop the error card again — the fresh reconnect has
  // its own budget — and the stream must be asked again.
  api.emptyNextStreams(1)
  const streamsBefore = api.state.streamUrls.length
  await page.getByRole('button', { name: '重试演出' }).click()
  await expect(page.locator('.story-manuscript')).toContainText(ACTION_LINE, { timeout: 20_000 })
  await expect(page.locator('.story-error')).toHaveCount(0)
  await expect(page.locator('.beat-paused--drama')).toBeVisible()
  // The empty response really happened: two stream requests, then a beat.
  expect(api.state.streamUrls.length).toBeGreaterThanOrEqual(streamsBefore + 2)
  expect(errors).toEqual([])
})

test('Stop abandons the uncommitted command, returns to idle, and never auto-resumes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page, { loseFirstAck: true })
  await api.install

  await startStory(page)
  api.setHolds(Number.POSITIVE_INFINITY)
  await submitAction(page, PLAYER_LINE)
  await expect(page.locator('.story-manuscript__player--pending')).toHaveCount(1)

  await page.locator('.beat-paused__advanced summary').click()
  await page.locator('.beat-controls button', { hasText: '停止' }).first().click()

  // Real state, not an error page: the player is back at the story setup.
  await expect(page.locator('.story-setup textarea')).toBeVisible()
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(api.state.stopCalls).toBe(1)
  expect(api.state.actions.filter((action) => action.action === 'act')).toHaveLength(1)

  const probesAtStop = api.state.stateProbes
  const streamsAtStop = api.state.generated.length + api.state.replayed.length
  await page.reload()
  await expect(page.locator('.story-setup textarea')).toBeVisible()
  // Longer than the largest retry delay (5s): a surviving retry timer would
  // probe /state here.
  await page.waitForTimeout(6_000)
  // A stopped run is abandoned locally: no state probe, no replay, no new bill.
  expect(api.state.stateProbes).toBe(probesAtStop)
  expect(api.state.generated.length + api.state.replayed.length).toBe(streamsAtStop)
  await expect(page.locator('.beat-paused--drama')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a 502 on the action is treated as an uncertain acknowledgement and finishes the move', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page)
  await api.install

  await startStory(page)
  api.failNextActionWith502()
  await submitAction(page, PLAYER_LINE)

  // The client never asks the player to do anything: it probes /state, sees
  // its own command pending, and reconnects to it.
  await expect(page.locator('.story-manuscript')).toContainText(ACTION_LINE, { timeout: 20_000 })
  await expect(page.locator('.beat-paused--drama')).toBeVisible()

  const command = String(api.state.actions[0].command_id)
  expect(api.state.actions).toHaveLength(1) // no second POST, no second command
  expect(api.state.generated.filter((id) => id === command)).toHaveLength(1)
  await expect(page.locator('.story-manuscript__player')).toHaveCount(1)
  await expect(page.locator('.story-manuscript__player--pending')).toHaveCount(0)
  await expect(page.locator('.story-manuscript__dialogue').filter({ hasText: ACTION_LINE })).toHaveCount(1)
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a refused action follows the command another tab already started', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page)
  await api.install

  await startStory(page)
  // Another tab already enqueued its move on this session.
  api.plantPending('cmd-foreign', FOREIGN_LINE)

  await submitAction(page, OTHER_LINE)

  // The refused move never reaches the manuscript; the session's real command
  // does, and the UI ends in a real beat state with a live stream behind it.
  await expect(page.locator('.story-manuscript')).toContainText(ACTION_LINE, { timeout: 20_000 })
  await expect(page.locator('.beat-paused--drama')).toBeVisible()
  await expect(page.locator('.story-manuscript')).toContainText(FOREIGN_LINE)
  await expect(page.locator('.story-manuscript')).not.toContainText(OTHER_LINE)
  await expect(page.locator('.story-manuscript__player--pending')).toHaveCount(0)
  expect(api.state.streamUrls.some((u) => u.includes('command_id=cmd-foreign'))).toBe(true)
  // Adoption reuses its first /state answer: between the refused action and
  // the stream for the foreign command there is exactly one probe, so a second
  // probe can never fail and strand the client in 'connecting'.
  const refusedAt = api.state.requestLog.findIndex((line) => line.startsWith('POST /api/session/net-story/action'))
  const streamAt = api.state.requestLog.findIndex((line) => line.includes('command_id=cmd-foreign'))
  const probes = api.state.requestLog
    .slice(refusedAt, streamAt)
    .filter((line) => line.startsWith('GET /api/session/net-story/state'))
  expect(probes).toHaveLength(1)
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a late /state answer for an old command cannot touch the newer one', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page, { loseAckWithoutRecording: true })
  await api.install

  await startStory(page)
  // The probe for the first move is slow; its answer arrives after the player
  // has already moved on.
  api.delayNextState(3_000)
  await submitAction(page, PLAYER_LINE)
  await expect(page.locator('.story-manuscript__player--pending')).toHaveCount(1)

  // The player sends a different move while that probe is still in flight.
  await submitAction(page, OTHER_LINE)
  await expect(page.locator('.story-manuscript')).toContainText(ACTION_LINE, { timeout: 20_000 })

  // Wait past the delayed answer, then prove it changed nothing: no resend of
  // the abandoned command, exactly the two actions the player actually made.
  await page.waitForTimeout(3_500)
  expect(api.state.actions.map((a) => a.player_input)).toEqual([PLAYER_LINE, OTHER_LINE])
  expect(api.state.generated.filter((id) => id === String(api.state.actions[1].command_id))).toHaveLength(1)
  await expect(page.locator('.story-manuscript')).toContainText(OTHER_LINE)
  await expect(page.locator('.story-manuscript')).not.toContainText(PLAYER_LINE)
  await expect(page.locator('.story-manuscript__player')).toHaveCount(1)
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Stop is retried and only clears the session once the server confirms', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page)
  await api.install

  await startStory(page)
  api.failNextStops(1)
  await page.locator('.beat-paused__advanced summary').click()
  await page.locator('.beat-controls button', { hasText: '停止' }).first().click()

  // The first stop never reached the server: the client re-asks and only then
  // drops the local session.
  await expect(page.locator('.story-setup textarea')).toBeVisible({ timeout: 10_000 })
  expect(api.state.stopCalls).toBe(2)
  expect(await page.evaluate(() => localStorage.getItem('abq_story_session_id'))).toBeNull()
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('an unconfirmed Stop keeps the session key and says so', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page)
  await api.install

  await startStory(page)
  api.failNextStops(99)
  await page.locator('.beat-paused__advanced summary').click()
  await page.locator('.beat-controls button', { hasText: '停止' }).first().click()

  // Bounded re-asks, then an honest notice — the run may still be generating
  // on the server, so the session key survives for a real retry.
  await expect(page.locator('.beat-paused__notice')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.beat-paused__notice')).toContainText('停止尚未确认')
  expect(api.state.stopCalls).toBe(3)
  expect(await page.evaluate(() => localStorage.getItem('abq_story_session_id'))).toBe('net-story')
  await expect(page.locator('.story-error')).toHaveCount(0)

  // Pressing Stop again can still confirm it.
  api.failNextStops(0)
  await page.locator('.beat-controls button', { hasText: '停止' }).first().click()
  await expect(page.locator('.story-setup textarea')).toBeVisible({ timeout: 10_000 })
  expect(await page.evaluate(() => localStorage.getItem('abq_story_session_id'))).toBeNull()
  expect(errors).toEqual([])
})

test('reopening a stopped session lands on idle instead of the beat controls', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.clear()
    for (const [key, value] of Object.entries({
      enteredWorld: true, productSurface: 'v3-mode-door', knowledgeTrack: 'fan',
      character: 'walter', language: 'zh', surface: 'story',
    })) localStorage.setItem(`abq_${key}`, JSON.stringify(value))
    localStorage.setItem('abq_story_session_id', 'net-story')
    localStorage.setItem('abq_story_session_key', 'net-key')
    // T10: author opt-in, or the stored Story surface is reclaimed pre-paint.
    localStorage.setItem('yishu_authoring_mode', '1')
  })
  const api = installRecoveryApi(page)
  await api.install
  api.state.status = 'stopped'
  api.state.pending = null

  await page.goto('/')

  // Stop is terminal: no Continue controls for a run that would only answer
  // story_stopped, no stream, and no session key left to auto-resume with.
  await expect(page.locator('.story-setup textarea')).toBeVisible()
  await expect(page.locator('.beat-paused--drama')).toHaveCount(0)
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('abq_story_session_id'))).toBeNull()
  expect(api.state.streamUrls).toEqual([])
  expect(errors).toEqual([])
})

test('an action POST that never answers recovers instead of spinning forever', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page)
  await api.install

  await startStory(page)
  await page.addInitScript(() => { /* deadline is a product constant */ })
  api.hangNextActions(1)
  await submitAction(page, PLAYER_LINE)

  // The request never resolves. After the client's own deadline it must treat
  // that exactly like a dropped acknowledgement: probe /state, see its command
  // pending, connect to it — never sit on a spinner with no stream.
  await expect(page.locator('.story-manuscript')).toContainText(ACTION_LINE, { timeout: 40_000 })
  await expect(page.locator('.beat-paused--drama')).toBeVisible()
  const command = String(api.state.actions[0].command_id)
  expect(api.state.generated.filter((id) => id === command)).toHaveLength(1)
  expect(api.state.streamUrls.some((u) => u.includes(`command_id=${command}`))).toBe(true)
  await expect(page.locator('.story-manuscript__player')).toHaveCount(1)
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('an unconfirmed Stop still fences a recovery that is already in flight', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page, { loseFirstAck: true })
  await api.install

  await startStory(page)
  // The probe for the lost acknowledgement is slow and still unanswered when
  // the player hits Stop. The stop itself NEVER confirms, so clearing the
  // session cannot be what saves us: the recovery must be fenced the moment
  // Stop is pressed.
  api.delayNextState(3_000)
  await submitAction(page, PLAYER_LINE)
  await expect(page.locator('.beat-paused__notice')).toBeVisible()

  api.failNextStops(99)
  await page.locator('.beat-paused__advanced summary').click()
  await page.locator('.beat-controls button', { hasText: '停止' }).first().click()
  await expect(page.locator('.beat-paused__notice')).toContainText('停止尚未确认', { timeout: 15_000 })

  const streamsAtStop = api.state.streamUrls.length
  const command = String(api.state.actions[0].command_id)
  // Let the late answer arrive: it must change nothing and must NOT reopen a
  // stream for a run the player already stopped.
  await page.waitForTimeout(4_000)
  expect(api.state.streamUrls.length).toBe(streamsAtStop)
  expect(api.state.streamUrls.some((u) => u.includes(`command_id=${command}`))).toBe(false)
  expect(api.state.generated).not.toContain(command)
  await expect(page.locator('.story-setup textarea')).toHaveCount(0)
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Stop during an in-flight resend still stops the run', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page, { loseAckWithoutRecording: true })
  await api.install

  await startStory(page)
  // The first POST is dropped without the server recording it, so the client
  // resends the same body — and that resend is still in the air when the
  // player stops.
  api.delayNextResend(3_000)
  await submitAction(page, PLAYER_LINE)
  await expect(page.locator('.story-manuscript__player--pending')).toHaveCount(1)

  api.failNextStops(99)
  await page.locator('.beat-paused__advanced summary').click()
  await page.locator('.beat-controls button', { hasText: '停止' }).first().click()
  await expect(page.locator('.beat-paused__notice')).toContainText('停止尚未确认', { timeout: 15_000 })

  const streamsAtStop = api.state.streamUrls.length
  const command = String(api.state.actions[0].command_id)
  await page.waitForTimeout(4_000)
  // The late resend answer must not adopt the session or open a stream.
  expect(api.state.streamUrls.length).toBe(streamsAtStop)
  expect(api.state.streamUrls.some((u) => u.includes(`command_id=${command}`))).toBe(false)
  expect(api.state.generated).not.toContain(command)
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a lost acknowledgement on the automatic resend still finishes the move', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seedStory(page)
  const api = installRecoveryApi(page, { loseAckWithoutRecording: true })
  await api.install

  await startStory(page)
  // First POST: dropped without the server recording it. The client resends the
  // same body; that resend lands server-side but its answer is a 502.
  api.failNextResends(1)
  await submitAction(page, PLAYER_LINE)

  await expect(page.locator('.story-manuscript')).toContainText(ACTION_LINE, { timeout: 30_000 })
  await expect(page.locator('.beat-paused--drama')).toBeVisible()

  const playerInputs = api.state.actions.map((a) => a.player_input)
  expect(playerInputs).toEqual([PLAYER_LINE, PLAYER_LINE])
  expect(api.state.actions[0].command_id).toBe(api.state.actions[1].command_id)
  await expect(page.locator('.story-manuscript__player')).toHaveCount(1)
  await expect(page.locator('.story-manuscript__player--pending')).toHaveCount(0)
  await expect(page.locator('.story-error')).toHaveCount(0)
  expect(errors).toEqual([])
})
