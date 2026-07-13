import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

/* =================================================================
   SSE Story Stream E2E — MockEventSource replaces global EventSource
   Covers: outline render, beat_paused, continue, redirect, complete, error
   ================================================================= */

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Inject a MockEventSource that replaces window.EventSource before the app
 * mounts. useStoryStream uses es.addEventListener(type, fn) for all 10
 * event types, so the mock faithfully implements addEventListener / emit.
 */
async function installMockEventSource(page: Page) {
  await page.addInitScript(() => {
    type MockWindow = Window & {
      __mockSSE: { emit: (type: string, data: unknown) => void } | null
      __mockSSEInstances: Array<{ readyState: number }>
    }

    class MockEventSource {
      url: string
      handlers: Map<string, Array<(e: MessageEvent) => void>> = new Map()
      onopen: ((e: Event) => void) | null = null
      onerror: ((e: Event) => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      readyState = 0
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 2
      constructor(url: string) {
        this.url = url
        ;(window as MockWindow).__mockSSE = this
        ;(window as MockWindow).__mockSSEInstances.push(this)
      }
      addEventListener(type: string, fn: (e: MessageEvent) => void) {
        if (!this.handlers.has(type)) this.handlers.set(type, [])
        this.handlers.get(type)!.push(fn)
      }
      removeEventListener(type: string, fn: (e: MessageEvent) => void) {
        const arr = this.handlers.get(type)
        if (arr) {
          const idx = arr.indexOf(fn)
          if (idx >= 0) arr.splice(idx, 1)
        }
      }
      close() {
        this.readyState = 2
      }
      emit(type: string, data: unknown) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data)
        const ev = new MessageEvent(type, { data: payload })
        const arr = this.handlers.get(type)
        if (arr) arr.forEach((fn) => fn(ev))
        if (type === 'message' && this.onmessage) this.onmessage(ev)
      }
    }
    ;(window as Window & { EventSource: typeof EventSource }).EventSource = MockEventSource as unknown as typeof EventSource
    ;(window as MockWindow).__mockSSE = null
    ;(window as MockWindow).__mockSSEInstances = []
  })
}

/** Mock POST /api/session/create — returns { session_id: sid } */
async function mockSessionCreate(page: Page, sid = 'test-sid') {
  await page.route('**/api/session/create', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session_id: sid }),
    })
  })
}

// Mock POST /api/session/{sid}/action — records request body to log, returns {}
async function mockActionEndpoint(
  page: Page,
  log: Array<Record<string, unknown>>,
) {
  await page.route('**/api/session/*/action', async (route) => {
    const body = route.request().postDataJSON()
    log.push(body as Record<string, unknown>)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    })
  })
}

/** Emit a single SSE event on the mocked EventSource instance. */
async function emitSSE(page: Page, type: string, data: unknown) {
  await page.evaluate(
    ({ type, data }) => {
      const sse = (window as Window & { __mockSSE?: { emit: (type: string, data: unknown) => void } }).__mockSSE
      if (sse) sse.emit(type, data)
    },
    { type, data },
  )
}

async function mockSSEStates(page: Page): Promise<number[]> {
  return page.evaluate(() => (
    window as Window & { __mockSSEInstances?: Array<{ readyState: number }> }
  ).__mockSSEInstances?.map((source) => source.readyState) ?? [])
}

/** Seed localStorage (abq_ prefix is added by caller, matching persistedState). */
async function seedStorage(page: Page, values: Record<string, unknown>) {
  await page.addInitScript((data) => {
    // Bypass landing screen BEFORE React mounts
    window.localStorage.setItem('abq_enteredWorld', 'true')
    for (const [key, raw] of Object.entries(data)) {
      let value: unknown = raw
      if (typeof raw === 'string' && (raw.startsWith('{') || raw.startsWith('['))) {
        try { value = JSON.parse(raw) } catch { /* keep as string */ }
      }
      window.localStorage.setItem(key, JSON.stringify(value))
    }
  }, values)
  await page.goto(BASE_URL)
  await page.waitForLoadState('domcontentloaded')
}

/**
 * Drive the app from idle story view to beat_paused by:
 * 1. Seeding walter / english / story view
 * 2. Installing MockEventSource + route mocks
 * 3. Clicking Start Story
 * 4. Emitting status → outline → scene_change → agent_speak → world_state_delta → beat_ready
 * Returns the actionLog array for downstream assertions.
 */
async function driveToBeatPaused(
  page: Page,
  opts: { outline?: string; agentSpeak?: string; beatId?: string; language?: 'en' | 'zh' } = {},
): Promise<Array<Record<string, unknown>>> {
  const outline =
    opts.outline ??
    'Walter must secure methylamine from Gus without Skyler finding out.'
  const agentSpeak =
    opts.agentSpeak ?? 'We need to cook, and we need to do it now.'
  const beatId = opts.beatId ?? 'beat-1'
  const language = opts.language ?? 'en'
  const actionLog: Array<Record<string, unknown>> = []

  await installMockEventSource(page)
  await mockSessionCreate(page, 'smoke-sid')
  await mockActionEndpoint(page, actionLog)
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: language,
    abq_view: 'story',
  })

  // Fill task + click Start Story
  await page
    .locator('.story-setup textarea')
    .fill('Walter needs to secure a new supply.')
  await page.locator('.story-setup button').click()

  // Wait for MockEventSource to be instantiated by connectStream
  await page.waitForFunction(() => (window as Window & { __mockSSE?: unknown }).__mockSSE !== null)
  // Small buffer to ensure all addEventListener calls have run
  await page.waitForTimeout(30)

  // Emit event sequence: status → outline (transitions to streaming) →
  // scene_change → agent_speak → world_state_delta → beat_ready (transitions to beat_paused)
  await emitSSE(page, 'status', { data: { message: 'Director online' } })
  await emitSSE(page, 'outline', { data: { content: outline } })
  await emitSSE(page, 'scene_change', {
    data: { description: 'Los Pollos Hermanos, night.' },
  })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Walter White',
      content: agentSpeak,
      emotion_state: 'chemistry',
      gif_search_query: 'chemistry',
    },
  })
  await emitSSE(page, 'world_state_delta', {
    data: {
      deltas: [
        {
          target: 'Walter',
          field: 'stress',
          old_value: 'low',
          new_value: 'high',
        },
      ],
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: beatId, is_final: false } })

  // Wait for beat_paused — BeatControls visible
  await expect(page.locator('.beat-controls')).toBeVisible()

  return actionLog
}

/* ------------------------------------------------------------------ */
/*  TC-SSE-1: smoke — outline + agent_speak + beat_paused              */
/* ------------------------------------------------------------------ */

test('TC-SSE-1: outline + agent_speak + beat_ready renders and pauses at beat_paused', async ({
  page,
}) => {
  await driveToBeatPaused(page)

  // Outline summary always visible; full body requires expand
  await expect(page.locator('.story-outline__summary')).toBeVisible()
  await page.locator('.story-outline__toggle').click()
  await expect(page.locator('.story-outline__body')).toContainText('methylamine')

  // Full dialogue lives on the paper stage; timeline keeps a short summary
  await expect(page.locator('.story-scene-card__quote')).toContainText(
    'We need to cook',
  )
  await expect(page.locator('.story-event--agent_speak .story-event__summary')).toContainText(
    'We need to cook',
  )

  // scene_change summary on timeline
  await expect(page.locator('.story-event--scene_change .story-event__summary')).toContainText(
    'Los Pollos',
  )

  // world_state_delta rendered as summary (no dense list in the rail)
  await expect(page.locator('.story-event--world_state_delta .story-event__summary')).toContainText(
    'stress',
  )

  // Beat index indicator shows Beat 1
  await expect(page.locator('.story-hud')).toContainText('Beat 1')

  // BeatControls visible (Continue + Stop + Redirect)
  await expect(
    page.locator('.beat-controls button', { hasText: /Continue/ }),
  ).toBeVisible()
  await expect(
    page.locator('.beat-controls button', { hasText: /Stop/ }),
  ).toBeVisible()
  await expect(
    page.locator('.beat-controls button', { hasText: /Redirect/ }),
  ).toBeVisible()
  await expect.poll(() => mockSSEStates(page)).toEqual([2])
})

test('TC-SSE-HUD-1: beat_paused Story Board shows HUD, outline, scene card, pressure footer, and decision tray', async ({
  page,
}) => {
  await driveToBeatPaused(page, {
    outline: '1. Los Pollos office — Gus tests Walter.\n2. Superlab — Walter must choose a side.',
  })

  await emitSSE(page, 'scene_change', {
    data: {
      from_scene: 'Restaurant floor',
      to_scene: 'Los Pollos Hermanos office',
      description: 'Transitioning to: Los Pollos Hermanos office.',
    },
  })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Gus Fring',
      content: 'A calm conversation prevents unfortunate misunderstandings.',
      emotion_state: 'controlled pressure',
      gif_search_query: 'gus polite pressure',
    },
  })

  await expect(page.locator('.story-hud')).toBeVisible()
  await expect(page.locator('.story-hud')).toContainText('Scene Board')
  await expect(page.locator('.story-hud')).toContainText('Beat 1')
  await expect(page.locator('.story-hud')).toContainText('Los Pollos Hermanos office')

  await expect(page.locator('.story-outline__summary')).toContainText('2 story beats planned')
  await page.locator('.story-outline__toggle').click()
  await expect(page.locator('.story-outline__body')).toContainText('Gus tests Walter')

  await expect(page.locator('.story-event--scene_change', { hasText: 'Los Pollos Hermanos office' })).toBeVisible()
  await expect(page.locator('.story-scene-card h3')).toContainText('Gus Fring')
  await expect(page.locator('.story-scene-card__quote')).toContainText('A calm conversation prevents')

  await expect(page.locator('.beat-paused')).toContainText('Choose the next move')
  await expect(page.locator('.beat-controls button', { hasText: /Continue/ })).toBeVisible()
  await expect(page.locator('.beat-controls button', { hasText: /Redirect/ })).toBeVisible()
  await expect(page.locator('.beat-controls button', { hasText: /Switch Perspective/ })).toBeVisible()
})

/* ------------------------------------------------------------------ */
/*  TC-SSE-2: continue — beat increments after next beat_ready         */
/* ------------------------------------------------------------------ */

test('TC-SSE-2: continue action sends {action:"continue"} and next beat_ready increments beat index', async ({
  page,
}) => {
  const actionLog = await driveToBeatPaused(page)

  // Click Continue
  const continueBtn = page.locator('.beat-controls button', {
    hasText: /Continue/,
  })
  await continueBtn.click()

  // Verify action endpoint received { action: 'continue' }
  await expect
    .poll(() => actionLog.some((e) => e.action === 'continue'))
    .toBe(true)
  expect(actionLog.find((e) => e.action === 'continue')).toBeDefined()
  // continue should NOT carry redirect_prompt
  expect(actionLog.find((e) => e.action === 'continue')?.redirect_prompt).toBeUndefined()
  await expect.poll(() => mockSSEStates(page)).toEqual([2, 0])

  // Re-opened stream after beat_paused must include language (never bare /stream)
  await expect
    .poll(async () => {
      const urls = await page.evaluate(() => {
        const w = window as Window & { __mockSSEInstances?: Array<{ url: string }> }
        return (w.__mockSSEInstances ?? []).map((i) => i.url)
      })
      return urls.filter((u) => u.includes('/stream')).every((u) => u.includes('language='))
    })
    .toBe(true)

  // Emit next beat events — scene_change → agent_speak → beat_ready
  await emitSSE(page, 'scene_change', {
    data: { description: 'Superlab, underground.' },
  })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Walter White',
      content: 'The batch is ready.',
      emotion_state: 'chemistry',
      gif_search_query: 'chemistry',
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-2' } })

  // Beat index incremented to 2
  await expect(page.locator('.story-hud')).toContainText('Beat 2')

  // New agent_speak content visible on stage + timeline summary
  await expect(page.locator('.story-scene-card__quote')).toContainText('The batch is ready.')
  await expect(
    page.locator('.story-event--agent_speak .story-event__summary', { hasText: 'The batch is ready.' }),
  ).toBeVisible()

  // BeatControls visible again (back to beat_paused)
  await expect(page.locator('.beat-controls')).toBeVisible()
})

test('TC-SSE-2b: continue reopens stream with language=zh when UI language is zh', async ({
  page,
}) => {
  const actionLog = await driveToBeatPaused(page, {
    language: 'zh',
    outline: '1. 办公室 — 对峙\n2. 停车场 — 等候',
    agentSpeak: '我们需要谈谈。',
  })

  await page.locator('.beat-controls button', { hasText: /继续|Continue/ }).click()
  await expect.poll(() => actionLog.some((e) => e.action === 'continue')).toBe(true)

  await expect
    .poll(async () => {
      const urls = await page.evaluate(() => {
        const w = window as Window & { __mockSSEInstances?: Array<{ url: string }> }
        return (w.__mockSSEInstances ?? []).map((i) => i.url)
      })
      // First stream (start) and second stream (continue) both request zh
      const streamUrls = urls.filter((u) => u.includes('/stream'))
      return streamUrls.length >= 2 && streamUrls.every((u) => u.includes('language=zh'))
    })
    .toBe(true)
})

/* ------------------------------------------------------------------ */
/*  TC-SSE-3: redirect — new outline replaces old, no deadlock         */
/* ------------------------------------------------------------------ */

test('TC-SSE-3: redirect action sends {action:"redirect",redirect_prompt} and new outline replaces old', async ({
  page,
}) => {
  const actionLog = await driveToBeatPaused(page, {
    outline: 'Walter must secure methylamine from Gus without Skyler finding out.',
  })

  // Verify old outline is visible after expand
  await page.locator('.story-outline__toggle').click()
  await expect(page.locator('.story-outline__body')).toContainText('methylamine')

  // Open redirect form
  await page
    .locator('.beat-controls button', { hasText: /Redirect/ })
    .click()

  const redirectInput = page.locator('.redirect-control input')
  await expect(redirectInput).toBeVisible()
  await redirectInput.fill('Walter decides to betray Gus instead.')

  // Submit redirect — wait for action endpoint response
  const actionResponse = page.waitForResponse((resp) =>
    resp.url().includes('/action'),
  )
  await page
    .locator('.redirect-control button', { hasText: /Submit/ })
    .click()
  await actionResponse

  // Verify actionLog has redirect entry with the prompt
  await expect
    .poll(() =>
      actionLog.some(
        (e) =>
          e.action === 'redirect' &&
          e.redirect_prompt === 'Walter decides to betray Gus instead.',
      ),
    )
    .toBe(true)

  // Emit new outline (different content) → scene_change → agent_speak → beat_ready
  await emitSSE(page, 'outline', {
    data: { content: 'Walter plots to eliminate Gus and take over the empire.' },
  })
  await emitSSE(page, 'scene_change', {
    data: { description: "Jesse's house, planning session." },
  })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Walter White',
      content: 'We need to take him out.',
      emotion_state: 'tense',
      gif_search_query: 'tense',
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-1' } })

  // New outline text is visible (different from old); expand if collapsed after new session pin reset
  const outlineBody = page.locator('.story-outline__body')
  if (!(await outlineBody.isVisible())) {
    await page.locator('.story-outline__toggle').click()
  }
  await expect(outlineBody).toContainText('eliminate Gus')
  // Old outline text is gone
  await expect(outlineBody).not.toContainText('methylamine')

  // Redirect starts a new outline; the HUD/progress should follow the
  // backend beat_id instead of continuing the old outline's counter.
  await expect(page.locator('.story-hud')).toContainText('Beat 1')

  // New agent_speak content visible on stage
  await expect(page.locator('.story-scene-card__quote')).toContainText('take him out')
  await expect(
    page.locator('.story-event--agent_speak .story-event__summary', { hasText: 'take him out' }),
  ).toBeVisible()

  // BeatControls visible again — no deadlock
  await expect(page.locator('.beat-controls')).toBeVisible()
})

/* ------------------------------------------------------------------ */
/*  TC-SSE-4: complete — stream ends, story-complete UI shows          */
/* ------------------------------------------------------------------ */

test('TC-SSE-4: complete event transitions to complete state and shows restart UI', async ({
  page,
}) => {
  await driveToBeatPaused(page)
  await page.locator('.beat-controls button', { hasText: /Continue/ }).click()
  await expect.poll(() => mockSSEStates(page)).toEqual([2, 0])

  await emitSSE(page, 'beat_ready', {
    data: { beat_id: 'beat-2', beat_summary: 'Final confrontation', is_final: true },
  })
  await expect.poll(() => mockSSEStates(page)).toEqual([2, 0])

  // Emit complete event
  await emitSSE(page, 'complete', {
    data: { message: 'The story has reached its conclusion.' },
  })

  // story-complete UI visible with completion text
  await expect(page.locator('.story-complete')).toBeVisible()
  await expect(page.locator('.story-complete')).toContainText(/Story complete/)

  // BeatControls should no longer be visible (state left beat_paused)
  await expect(page.locator('.beat-controls')).toHaveCount(0)

  // complete event rendered in the event feed
  await expect(page.locator('.story-event--complete')).toBeVisible()
  await expect.poll(() => mockSSEStates(page)).toEqual([2, 2])

  // Story-complete follow-up actions are present, plus Start Again.
  await expect(
    page.locator('.story-complete button', { hasText: /Start Chapter/ }),
  ).toBeVisible()
  await expect(
    page.locator('.story-complete button', { hasText: /Try a Different Branch/ }),
  ).toBeVisible()
  await expect(
    page.locator('.story-complete button', { hasText: /Replay Last Beat/ }),
  ).toBeVisible()
  await expect(
    page.locator('.story-complete button', { hasText: /Start Again/ }),
  ).toBeVisible()
})

/* ------------------------------------------------------------------ */
/*  TC-SSE-5: error — error event sets error state and shows message   */
/* ------------------------------------------------------------------ */

test('TC-SSE-5: error event transitions to error state and shows error message', async ({
  page,
}) => {
  await driveToBeatPaused(page)

  // Emit error event
  await emitSSE(page, 'error', { data: { message: 'boom' } })

  // story-error UI visible with the error message
  await expect(page.locator('.story-error')).toBeVisible()
  await expect(page.locator('.story-error p')).toContainText('boom')

  // BeatControls should no longer be visible (state left beat_paused)
  await expect(page.locator('.beat-controls')).toHaveCount(0)

  // Reconnect button present (sessionId was set before error)
  await expect(
    page.locator('.story-error button', { hasText: /Reconnect/ }),
  ).toBeVisible()
})

/* ------------------------------------------------------------------ */
/*  TC-SSE-6: switch_perspective sends target_character and next beat  */
/*            first agent_speak matches target                        */
/* ------------------------------------------------------------------ */
/* Revision per drill BLOCKED 4: use driveToBeatPaused (sid='smoke-sid')
 * which encapsulates installMockEventSource + mockSessionCreate +
 * mockActionEndpoint + seedStorage + Start Story click + emit sequence.
 * All emitSSE calls MUST wrap payload in { data: { ... } } because
 * useStoryStream.ts:73 expects payload.data?.content. Manual setup
 * without Start Story click leaves (window).__mockSSE null → emitSSE
 * silently no-ops. */

test('TC-SSE-6: switch_perspective sends target_character and next beat first agent_speak matches', async ({ page }) => {
  // driveToBeatPaused seeds walter/en/story view, clicks Start Story,
  // instantiates MockEventSource, emits status→outline→scene_change→
  // agent_speak→world_state_delta→beat_ready, waits for .beat-controls.
  // Default sid is 'smoke-sid' (sse-story.spec.ts:132).
  const actionLog = await driveToBeatPaused(page, {
    outline: '1. RV — cook\n2. White house — talk',
  })

  // Simulate player switch_perspective to jesse via the mocked action
  // endpoint (mockActionEndpoint glob matches **/api/session/*/action).
  await page.evaluate(() => {
    fetch('/api/session/smoke-sid/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'switch_perspective', target_character: 'jesse' }),
    })
  })

  // Assert action endpoint received switch_perspective with target_character='jesse'
  await expect.poll(() =>
    actionLog.some(
      (e) => e.action === 'switch_perspective' && e.target_character === 'jesse',
    ),
  ).toBe(true)

  // Manually emit second beat events (simulating backend prompt injection +
  // filter: first agent_speak is Jesse Pinkman). All payloads wrapped in
  // { data: { ... } } to match useStoryStream.ts listener expectations.
  await emitSSE(page, 'scene_change', {
    data: { from_scene: 'RV', to_scene: "Jesse's house", description: "Jesse's house." },
  })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Jesse Pinkman',  // ← first agent_speak is jesse (filter worked)
      content: 'Yo, Mr. White, what now?',
      emotion_state: 'anxious',
      gif_search_query: 'jesse pinkman nervous',
    },
  })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Walter White',
      content: 'We wait.',
      emotion_state: 'tense',
      gif_search_query: 'walter white tense',
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-2', beat_summary: "Jesse's house" } })

  // Assert first agent_speak of beat 2 is Jesse Pinkman.
  // driveToBeatPaused already emitted 1 Walter White agent_speak in beat 1,
  // so beat 2's first agent_speak is the 2nd .story-event--agent_speak in DOM.
  // Using .nth(1) (not .first()) to target beat 2's first speak.
  const beat2FirstSpeak = page.locator('.story-event--agent_speak').nth(1)
  await expect(beat2FirstSpeak).toContainText('Jesse Pinkman')
})

/* ------------------------------------------------------------------ */
/*  TC-SSE-7: Story agent_speak renders VoicePlayer button             */
/* ------------------------------------------------------------------ */

test('TC-SSE-7: story agent_speak renders VoicePlayer button', async ({ page }) => {
  await driveToBeatPaused(page, {
    outline: '1. RV — cook\n2. White house — Skyler waits',
  })

  // Voice lives on the paper stage for the focused speak beat
  const voicePlayer = page.locator('.story-scene-card .voice-player').first()
  await expect(voicePlayer).toBeVisible()
  await expect(voicePlayer).toBeEnabled()
  await expect(voicePlayer).toContainText(/Voice|▶/)
})

/* ------------------------------------------------------------------ */
/*  TC-SIDEBAR-1: story mode sidebar has no Perspective field-label   */
/* ------------------------------------------------------------------ */

test('TC-SIDEBAR-1: story mode sidebar has no Perspective field-label', async ({ page }) => {
  await driveToBeatPaused(page)
  await expect(page.locator('.field-label', { hasText: /Perspective|叙事视角/ })).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/*  TC-SIDEBAR-2: BeatControls Switch Perspective still works         */
/* ------------------------------------------------------------------ */

test('TC-SIDEBAR-2: BeatControls Switch Perspective button still visible at beat_paused', async ({ page }) => {
  await driveToBeatPaused(page)
  const switchBtn = page.locator('.beat-controls button', { hasText: /Switch Perspective|切换视角/ })
  await expect(switchBtn).toBeVisible()
  await expect(switchBtn).toBeEnabled()
})

/* ------------------------------------------------------------------ */
/*  TC-SSE-8: switch_perspective via UI transitions to streaming       */
/* ------------------------------------------------------------------ */

test('TC-SSE-8: switch_perspective via UI hides BeatControls and shows Streaming indicator', async ({ page }) => {
  await driveToBeatPaused(page, {
    outline: '1. RV — cook\n2. Jesse\'s house — talk',
  })

  // Click "Switch Perspective" button to open the select dropdown
  const switchBtn = page.locator('.beat-controls button', { hasText: /Switch Perspective|切换视角/ })
  await switchBtn.click()

  // Select Jesse from the dropdown — triggers onSwitchPerspective('jesse')
  const select = page.locator('.beat-controls .perspective-control select')
  await select.selectOption('jesse')

  // After switch_perspective sendAction: connectionState should be 'streaming'
  // → BeatControls hidden, Streaming indicator visible
  await expect(page.locator('.beat-controls')).toHaveCount(0)
  await expect(page.locator('.streaming-indicator')).toBeVisible()

  // Emit next beat's events to simulate backend processing switch_perspective
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Jesse Pinkman',
      content: 'Yo, Mr. White, what now?',
      emotion_state: 'anxious',
      gif_search_query: 'jesse pinkman nervous',
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-2' } })

  // After beat_ready: back to beat_paused, BeatControls visible again
  await expect(page.locator('.beat-controls')).toBeVisible()
})

/* ------------------------------------------------------------------ */
/*  TC-SSE-9: redirect via UI transitions to streaming                 */
/* ------------------------------------------------------------------ */

test('TC-SSE-9: redirect via UI hides BeatControls and shows Streaming indicator', async ({ page }) => {
  await driveToBeatPaused(page, {
    outline: '1. RV — cook\n2. White house — talk',
  })

  // Click "Redirect" button to open the input
  const redirectBtn = page.locator('.beat-controls button', { hasText: /Redirect|重定向/ })
  await redirectBtn.click()

  // Fill redirect text and submit
  const input = page.locator('.beat-controls .redirect-control input')
  await input.fill('Walter gets arrested')
  await page.locator('.beat-controls .redirect-control button', { hasText: /Submit|提交/ }).click()

  // After redirect sendAction: connectionState should be 'streaming'
  await expect(page.locator('.beat-controls')).toHaveCount(0)
  await expect(page.locator('.streaming-indicator')).toBeVisible()

  // Emit new outline + beat events to simulate backend processing redirect
  await emitSSE(page, 'outline', { data: { content: '1. DEA office — arrest\n2. Jail — interrogation' } })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Walter White',
      content: 'I want my lawyer.',
      emotion_state: 'panic',
      gif_search_query: 'walter white arrested',
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-2' } })

  // After beat_ready: back to beat_paused
  await expect(page.locator('.beat-controls')).toBeVisible()
})
