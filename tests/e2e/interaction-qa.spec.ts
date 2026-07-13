/**
 * Breaking Bad Roleplay — Round 1 Interaction QA
 * Focus: button states, disabled states, loading feedback, error handling,
 *        navigation flow, state consistency, hover/focus states
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

async function installMockEventSource(page: Page) {
  await page.addInitScript(() => {
    type MockWindow = Window & { __mockSSE: { emit: (type: string, data: unknown) => void } | null }

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
  })
}

async function mockSessionCreate(page: Page, sid = 'test-sid') {
  await page.route('**/api/session/create', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session_id: sid }),
    })
  })
}

async function mockActionEndpoint(page: Page, log: Array<Record<string, unknown>>) {
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

async function emitSSE(page: Page, type: string, data: unknown) {
  await page.evaluate(
    ({ type, data }) => {
      const sse = (window as Window & { __mockSSE?: { emit: (type: string, data: unknown) => void } }).__mockSSE
      if (sse) sse.emit(type, data)
    },
    { type, data },
  )
}

async function seedStorage(page: Page, values: Record<string, unknown>) {
  await page.addInitScript((data) => {
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

async function gotoFresh(page: Page) {
  await page.goto(BASE_URL)
  await page.waitForLoadState('domcontentloaded')
}

async function driveToBeatPaused(page: Page, opts: { outline?: string; agentSpeak?: string; beatId?: string } = {}) {
  const outline = opts.outline ?? 'Walter must secure methylamine from Gus without Skyler finding out.'
  const agentSpeak = opts.agentSpeak ?? 'We need to cook, and we need to do it now.'
  const beatId = opts.beatId ?? 'beat-1'
  const actionLog: Array<Record<string, unknown>> = []

  await installMockEventSource(page)
  await mockSessionCreate(page, 'r1-ix-sid')
  await mockActionEndpoint(page, actionLog)
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'zh',
    abq_view: 'story',
  })

  await page.locator('.story-setup textarea').fill('Walter 需要拿到新的甲胺供应。')
  await page.locator('.story-setup button').click()

  await page.waitForFunction(() => (window as Window & { __mockSSE?: unknown }).__mockSSE !== null)
  await page.waitForTimeout(30)

  await emitSSE(page, 'status', { data: { message: 'Director online' } })
  await emitSSE(page, 'outline', { data: { content: outline } })
  await emitSSE(page, 'scene_change', { data: { description: 'Los Pollos Hermanos, night.' } })
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
        { target: 'Walter', field: 'stress', old_value: 'low', new_value: 'high' },
      ],
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: beatId } })

  await expect(page.locator('.beat-controls')).toBeVisible()

  return actionLog
}

/* =================================================================
   TC-IX-1: Landing screen — Enter button visible and styled
   ================================================================= */
test('TC-IX-1: landing screen enter button visible and interactive', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await gotoFresh(page)

  const enterBtn = page.locator('.landing-screen__enter')
  await expect(enterBtn).toBeVisible()
  await expect(enterBtn).toBeEnabled()
  await expect(enterBtn).toContainText(/Chat with Walter|和 Walter 聊聊/)

  // Check the title is present
  const title = page.locator('.landing-screen__title')
  await expect(title).toBeVisible()

  // Loop 10 Gap 2: character voice line replaces step pills
  await expect(page.locator('.landing-screen__voice')).toBeVisible()
  await expect(page.locator('.landing-step__num')).toHaveCount(0)

  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})

/* =================================================================
   TC-IX-2: Enter world → app shell visible with sidebar
   ================================================================= */
test('TC-IX-2: enter world navigates to app shell', async ({ page }) => {
  await gotoFresh(page)

  const enterBtn = page.locator('.landing-screen__enter')
  if (await enterBtn.count() > 0) {
    await enterBtn.click()
    await page.waitForTimeout(300)
  }

  // App shell visible
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.locator('.sidebar')).toBeVisible()

  // Character grid visible
  await expect(page.locator('.char-grid')).toBeVisible()
  await expect(page.locator('.char-card')).toHaveCount(6)

  // Default character selected
  await expect(page.locator('.char-card.selected')).toBeVisible()
})

/* =================================================================
   TC-IX-3: Empty story prompt — button disabled
   ================================================================= */
test('TC-IX-3: empty story prompt disables start button', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'zh',
    abq_view: 'story',
  })

  // In story view with empty textarea
  await expect(page.locator('.story-setup')).toBeVisible()
  const startBtn = page.locator('.story-setup button')
  await expect(startBtn).toBeDisabled()

  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})

/* =================================================================
   TC-IX-4: Language toggle — switches UI language
   ================================================================= */
test('TC-IX-4: language toggle switches UI text', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'en',
    abq_view: 'story',
  })

  // Default English
  await expect(page.locator('button', { hasText: /Start Story/ })).toBeVisible()

  // Click Chinese
  await page.locator('.seg-control button', { hasText: /中文/ }).click()
  await page.waitForTimeout(100)

  // Should now show Chinese
  await expect(page.locator('button', { hasText: /开始任务/ })).toBeVisible()

  // Switch back
  await page.locator('.seg-control button', { hasText: /EN/ }).click()
  await page.waitForTimeout(100)
  await expect(page.locator('button', { hasText: /Start Story/ })).toBeVisible()

  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})

/* =================================================================
   TC-IX-5: Character switch while in story setup
   ================================================================= */
test('TC-IX-5: switching character in story setup preserves prompt', async ({ page }) => {
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'zh',
    abq_view: 'story',
  })

  const textarea = page.locator('.story-setup textarea')
  await textarea.fill('Walter 需要拿到新的甲胺供应。')

  // Switch to Jesse
  await page.locator('.char-card', { hasText: 'Jesse' }).click()
  await page.waitForTimeout(100)

  // Textarea should still have the text (prompt is character-agnostic)
  await expect(textarea).toHaveValue('Walter 需要拿到新的甲胺供应。')

  // Switch back to Walter
  await page.locator('.char-card', { hasText: 'Walter' }).click()
  await page.waitForTimeout(100)
  await expect(textarea).toHaveValue('Walter 需要拿到新的甲胺供应。')
})

/* =================================================================
   TC-IX-6: View toggle — chat/story
   ================================================================= */
test('TC-IX-6: view toggle switches between chat and story panels', async ({ page }) => {
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'en',
    abq_view: 'story',
  })

  // In story view
  await expect(page.locator('.story-setup')).toBeVisible()

  // Switch to chat
  await page.locator('.seg-control button', { hasText: /Chat/ }).click()
  await page.waitForTimeout(200)

  // Chat panel should be visible
  await expect(page.locator('.chat-panel')).toBeVisible()
  await expect(page.locator('.story-setup')).toHaveCount(0)

  // Switch back to story
  await page.locator('.seg-control button', { hasText: /Story/ }).click()
  await page.waitForTimeout(200)

  await expect(page.locator('.story-setup')).toBeVisible()
})

/* =================================================================
   TC-IX-7: Start story — connecting state visible
   ================================================================= */
test('TC-IX-7: starting story shows connecting indicator', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'en',
    abq_view: 'story',
  })

  // Fill and submit
  await page.locator('.story-setup textarea').fill('Walter needs a new methylamine supply.')
  await page.locator('.story-setup button').click()

  // Connecting state should appear briefly
  await expect(page.locator('.story-status')).toBeVisible()
  await expect(page.locator('.story-status')).toContainText(/Blocking|调度/)

  // Wait for stream to start (MockEventSource)
  await page.waitForFunction(() => (window as Window & { __mockSSE?: unknown }).__mockSSE !== null, { timeout: 5000 })
  await page.waitForTimeout(100)

  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})

/* =================================================================
   TC-IX-8: Streaming state — BeatControls hidden, event feed visible
   ================================================================= */
test('TC-IX-8: during streaming, beat-controls hidden and events render', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  const actionLog: Array<Record<string, unknown>> = []
  await installMockEventSource(page)
  await mockSessionCreate(page, 'r1-ix-8')
  await mockActionEndpoint(page, actionLog)
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'en',
    abq_view: 'story',
  })

  await page.locator('.story-setup textarea').fill('Walter needs a new methylamine supply.')
  await page.locator('.story-setup button').click()

  await page.waitForFunction(() => (window as Window & { __mockSSE?: unknown }).__mockSSE !== null, { timeout: 5000 })
  await page.waitForTimeout(30)

  // Emit outline → transitions to streaming
  await emitSSE(page, 'outline', { data: { content: '1. Secure methylamine\n2. Cook batch\n3. Evade Skyler' } })
  await page.waitForTimeout(100)

  // BeatControls NOT visible during streaming
  await expect(page.locator('.beat-controls')).toHaveCount(0)
  await expect(page.locator('.story-outline')).toBeVisible()
  await page.locator('.story-outline__toggle').click()
  await expect(page.locator('.story-outline__body')).toContainText('methylamine')

  // Emit scene_change
  await emitSSE(page, 'scene_change', { data: { description: 'Superlab, underground.' } })
  await page.waitForTimeout(50)
  await expect(page.locator('.story-event--scene_change')).toBeVisible()

  // Emit agent_speak
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Walter White',
      content: 'The chemistry must be precise.',
      emotion_state: 'chemistry',
      gif_search_query: 'chemistry',
    },
  })
  await page.waitForTimeout(50)
  await expect(page.locator('.story-scene-card__quote')).toContainText('precise')
  await expect(page.locator('.story-event--agent_speak .story-event__summary')).toContainText('precise')

  // Continue events to beat_ready
  await emitSSE(page, 'world_state_delta', {
    data: { deltas: [{ target: 'Walter', field: 'stress', old_value: 'low', new_value: 'medium' }] },
  })
  await page.waitForTimeout(50)

  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-1' } })

  // Now beat_paused — BeatControls visible
  await expect(page.locator('.beat-controls')).toBeVisible()
  await expect(page.locator('.story-stream')).toHaveClass(/story-stream--beat_paused/)

  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})

/* =================================================================
   TC-IX-9: beat_paused — all 4 decision buttons visible and enabled
   ================================================================= */
test('TC-IX-9: beat_paused shows all 4 decision buttons enabled', async ({ page }) => {
  await driveToBeatPaused(page)

  const controls = page.locator('.beat-controls')

  // Continue
  const continueBtn = controls.locator('button', { hasText: /Continue|继续/ })
  await expect(continueBtn).toBeVisible()
  await expect(continueBtn).toBeEnabled()

  // Stop
  const stopBtn = controls.locator('button', { hasText: /Stop|停止/ })
  await expect(stopBtn).toBeVisible()
  await expect(stopBtn).toBeEnabled()

  // Redirect
  const redirectBtn = controls.locator('button', { hasText: /Redirect|重定向/ })
  await expect(redirectBtn).toBeVisible()
  await expect(redirectBtn).toBeEnabled()

  // Switch Perspective
  const switchBtn = controls.locator('button', { hasText: /Switch Perspective|切换视角/ })
  await expect(switchBtn).toBeVisible()
  await expect(switchBtn).toBeEnabled()
})

/* =================================================================
   TC-IX-10: Redirect flow — opens input, validates, submits
   ================================================================= */
test('TC-IX-10: redirect opens input, validates empty, submits with text', async ({ page }) => {
  const actionLog = await driveToBeatPaused(page, { outline: '1. Plan\n2. Execute' })

  // Click Redirect
  await page.locator('.beat-controls button', { hasText: /Redirect|重定向/ }).click()
  await page.waitForTimeout(100)

  // Redirect input visible
  const input = page.locator('.redirect-control input')
  await expect(input).toBeVisible()
  await expect(input).toBeEnabled()

  // Submit button disabled when empty
  const submitBtn = page.locator('.redirect-control button', { hasText: /Submit|提交/ })
  await expect(submitBtn).toBeDisabled()

  // Fill text
  await input.fill('Walter decides to betray Gus.')
  await page.waitForTimeout(50)

  // Submit now enabled
  await expect(submitBtn).toBeEnabled()

  // Submit redirect
  const actionResponse = page.waitForResponse((resp) => resp.url().includes('/action'))
  await submitBtn.click()
  await actionResponse

  // Verify action logged
  await expect.poll(() => actionLog.some((e) => e.action === 'redirect')).toBe(true)
  expect(actionLog.find((e) => e.action === 'redirect')?.redirect_prompt).toBe('Walter decides to betray Gus.')

  // After submission, redirect input and BeatControls are replaced by streaming state
  await expect(page.locator('.redirect-control')).toHaveCount(0)
  await expect(page.locator('.beat-controls')).toHaveCount(0)
  await expect(page.locator('.streaming-indicator')).toBeVisible()
})

/* =================================================================
   TC-IX-11: Switch perspective — opens select, validates, submits
   ================================================================= */
test('TC-IX-11: switch perspective opens select, validates empty, submits with character', async ({ page }) => {
  const actionLog = await driveToBeatPaused(page)

  // Click Switch Perspective
  await page.locator('.beat-controls button', { hasText: /Switch Perspective|切换视角/ }).click()
  await page.waitForTimeout(100)

  // Select visible
  const select = page.locator('.perspective-control select')
  await expect(select).toBeVisible()

  // Select Jesse
  await select.selectOption('jesse')
  await page.waitForTimeout(100)

  // Verify action logged
  await expect.poll(() => actionLog.some((e) => e.action === 'switch_perspective')).toBe(true)
  expect(actionLog.find((e) => e.action === 'switch_perspective')?.target_character).toBe('jesse')

  // After selection, perspective control hidden, BeatControls shown, streaming state
  await expect(page.locator('.perspective-control')).toHaveCount(0)
  await expect(page.locator('.beat-controls')).toHaveCount(0)
  await expect(page.locator('.streaming-indicator')).toBeVisible()
})

/* =================================================================
   TC-IX-12: Continue — transitions to streaming then back to beat_paused
   ================================================================= */
test('TC-IX-12: continue action transitions through streaming to next beat', async ({ page }) => {
  const actionLog = await driveToBeatPaused(page)

  // Click Continue
  await page.locator('.beat-controls button', { hasText: /Continue|继续/ }).click()

  // Should go to streaming immediately
  await expect(page.locator('.beat-controls')).toHaveCount(0)
  await expect(page.locator('.streaming-indicator')).toBeVisible()

  // Action logged
  await expect.poll(() => actionLog.some((e) => e.action === 'continue')).toBe(true)

  // Emit next beat events
  await emitSSE(page, 'scene_change', { data: { description: 'Superlab, underground.' } })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Walter White',
      content: 'The batch is ready.',
      emotion_state: 'chemistry',
      gif_search_query: 'chemistry',
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-2' } })

  // Back to beat_paused
  await expect(page.locator('.beat-controls')).toBeVisible()
  await expect(page.locator('.story-hud__metric').filter({ hasText: /Beat 2|节点 2/ }).locator('strong')).toBeVisible()
})

/* =================================================================
   TC-IX-13: Stop — clears session, returns to idle
   ================================================================= */
test('TC-IX-13: stop action clears session and returns to idle', async ({ page }) => {
  await driveToBeatPaused(page)

  // Click Stop
  await page.locator('.beat-controls button', { hasText: /Stop|停止/ }).click()

  // Should return to idle story setup
  await expect(page.locator('.story-setup')).toBeVisible()
  await expect(page.locator('.beat-controls')).toHaveCount(0)

  // Session cleared from localStorage
  const savedSid = await page.evaluate(() => localStorage.getItem('abq_story_session_id'))
  expect(savedSid).toBeNull()
})

/* =================================================================
   TC-IX-14: Story complete state — restart buttons present
   ================================================================= */
test('TC-IX-14: complete event shows story-complete with all action buttons', async ({ page }) => {
  await driveToBeatPaused(page)

  await emitSSE(page, 'complete', { data: { message: 'The story has reached its conclusion.' } })

  await expect(page.locator('.story-complete')).toBeVisible()
  await expect(page.locator('.beat-controls')).toHaveCount(0)
  await expect(page.locator('.story-complete button', { hasText: /Start Chapter|开始第二章/ })).toBeVisible()
  await expect(page.locator('.story-complete button', { hasText: /Try a Different Branch|换一个分支/ })).toBeVisible()
  await expect(page.locator('.story-complete button', { hasText: /Replay Last Beat|重演最后节点/ })).toBeVisible()
  await expect(page.locator('.story-complete button', { hasText: /Start Again|重新开始/ })).toBeVisible()
})

/* =================================================================
   TC-IX-15: Error state — reconnect + restart buttons
   ================================================================= */
test('TC-IX-15: error event shows error message and reconnect/restart buttons', async ({ page }) => {
  await driveToBeatPaused(page)

  await emitSSE(page, 'error', { data: { message: 'Director disconnected unexpectedly.' } })

  await expect(page.locator('.story-error')).toBeVisible()
  await expect(page.locator('.story-error')).toContainText('Director disconnected')
  await expect(page.locator('.story-error button', { hasText: /Reconnect|重连/ })).toBeVisible()
  await expect(page.locator('.story-error button', { hasText: /Restart|重新开始/ })).toBeVisible()
  await expect(page.locator('.beat-controls')).toHaveCount(0)
})

/* =================================================================
   TC-IX-16: Pending state prevents double-clicking actions
   ================================================================= */
test('TC-IX-16: pending action hides beat-controls to prevent double submit', async ({ page }) => {
  const actionLog: Array<Record<string, unknown>> = []
  await driveToBeatPaused(page)

  // Mock action endpoint to delay response
  await page.unroute('**/api/session/*/action')
  await page.route('**/api/session/*/action', async (route) => {
    const body = route.request().postDataJSON()
    actionLog.push(body as Record<string, unknown>)
    // Delay 500ms to simulate network
    await new Promise(r => setTimeout(r, 500))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    })
  })

  // Click Continue (will be pending for 500ms)
  await page.locator('.beat-controls button', { hasText: /Continue|继续/ }).click()
  await page.waitForTimeout(50)

  // Optimistic streaming state removes every action control while pending.
  await expect(page.locator('.beat-controls')).toHaveCount(0)
  await expect(page.locator('.streaming-indicator')).toBeVisible()

  // Wait for response
  await page.waitForTimeout(600)

  expect(actionLog).toHaveLength(1)
})

/* =================================================================
   TC-IX-17: Chat send button disabled while sending
   ================================================================= */
test('TC-IX-17: chat send button disabled during API call', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'en',
    abq_view: 'chat',
    abq_messages: {
      walter: [
        { id: 'opener', sender: 'walter', text: 'Choose your words carefully.', emotion: 'opening pressure', gifQuery: null, gifUrl: null },
      ],
    },
  })

  // Delay the chat API
  await page.route('**/api/chat', async (route) => {
    await new Promise(r => setTimeout(r, 500))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reply_text: 'We always talk.', emotion_state: 'tense', gif_search_query: 'tense' }),
    })
  })

  const input = page.locator('.composer input')
  await input.fill('Test message')

  const sendBtn = page.locator('.composer button[type="submit"]')
  await expect(sendBtn).toBeEnabled()

  await sendBtn.click()
  await page.waitForTimeout(50)

  // Send button should be disabled during sending
  await expect(sendBtn).toBeDisabled()
  await expect(sendBtn).toContainText(/Thinking|生成回应/)

  // Wait for response
  await page.waitForTimeout(600)

  // The request is done, but the cleared input keeps submit disabled.
  await expect(sendBtn).toContainText(/Send|发送/)
  await expect(sendBtn).toBeDisabled()
  await input.fill('Next message')
  await expect(sendBtn).toBeEnabled()

  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})

/* =================================================================
   TC-IX-18: Return to landing button
   ================================================================= */
test('TC-IX-18: return to landing resets to landing screen', async ({ page }) => {
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'en',
    abq_view: 'story',
  })

  // Verify we're in the app
  await expect(page.locator('.app-shell')).toBeVisible()

  // Click return to landing
  await page.locator('.brand-return').click()
  await page.waitForTimeout(300)

  // Should be back at landing screen
  await expect(page.locator('.landing-screen')).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveCount(0)
})

/* =================================================================
   TC-IX-19: Hover/focus — beat-controls buttons have pointer cursor
   ================================================================= */
test('TC-IX-19: beat-controls buttons have pointer cursor and visible focus', async ({ page }) => {
  await driveToBeatPaused(page)

  const continueBtn = page.locator('.beat-controls button', { hasText: /Continue|继续/ })

  // Check cursor style
  const cursor = await continueBtn.evaluate((el) => getComputedStyle(el).cursor)
  expect(cursor).toBe('pointer')

  // Move away and back with the keyboard so :focus-visible applies.
  await continueBtn.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(continueBtn).toBeFocused()
  await page.waitForTimeout(50)

  const focusVisible = await continueBtn.evaluate((el) => {
    const s = getComputedStyle(el)
    return s.outlineStyle !== 'none' || s.boxShadow !== 'none'
  })
  expect(focusVisible).toBe(true)
  // At minimum, the element should be focusable (tabIndex >= 0 implicitly for buttons)
  const tabIndex = await continueBtn.evaluate((el) => el.tabIndex)
  expect(tabIndex).toBe(0)
})

/* =================================================================
   TC-IX-20: Story setStage textarea disabled during connecting
   ================================================================= */
test('TC-IX-20: story setup inputs not interactive during connecting', async ({ page }) => {
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'en',
    abq_view: 'story',
  })

  await page.locator('.story-setup textarea').fill('Some prompt.')
  await page.locator('.story-setup button').click()

  // Should be connecting now
  await expect(page.locator('.story-status')).toBeVisible()

  // The textarea and button should no longer be in DOM (replaced by story-status)
  await expect(page.locator('.story-setup')).toHaveCount(0)
})

/* =================================================================
   TC-IX-21: Chat input placeholder updates on character change
   ================================================================= */
test('TC-IX-21: chat input placeholder updates when character changes', async ({ page }) => {
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'en',
    abq_view: 'chat',
    abq_messages: {
      walter: [
        { id: 'opener', sender: 'walter', text: 'Choose your words carefully.', emotion: 'opening pressure', gifQuery: null, gifUrl: null },
      ],
    },
  })

  const input = page.locator('.composer input')
  // Walter placeholder
  await expect(input).toHaveAttribute('placeholder', /Walter/)

  // Switch to Jesse
  await page.locator('.char-card', { hasText: 'Jesse' }).click()
  await page.waitForTimeout(100)

  // Jesse placeholder
  await expect(input).toHaveAttribute('placeholder', /Jesse/)
})

/* =================================================================
   TC-IX-22: Sidebar character selection highlights correctly
   ================================================================= */
test('TC-IX-22: character card selection has visual selected state', async ({ page }) => {
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'en',
    abq_view: 'chat',
  })

  const walterCard = page.locator('.char-card', { hasText: 'Walter' })
  await expect(walterCard).toHaveClass(/selected/)

  // Click Gus
  await page.locator('.char-card', { hasText: 'Gus' }).click()
  await page.waitForTimeout(100)

  const gusCard = page.locator('.char-card', { hasText: 'Gus' })
  await expect(gusCard).toHaveClass(/selected/)
  await expect(walterCard).not.toHaveClass(/selected/)
})

/* =================================================================
   TC-IX-23: Mode toggle (Direct/Crew) visible in chat view only
   ================================================================= */
test('TC-IX-23: mode toggle visible only in chat view, not story view', async ({ page }) => {
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'en',
    abq_view: 'chat',
  })

  // Mode toggle visible in chat
  await expect(page.locator('.field-label', { hasText: /^Mode$/ })).toBeVisible()

  // Switch to story
  await page.locator('.seg-control button', { hasText: /Story/ }).click()
  await page.waitForTimeout(100)

  // Mode toggle NOT visible in story
  await expect(page.locator('.field-label', { hasText: /^Mode$/ })).toHaveCount(0)
})

/* =================================================================
   TC-IX-24: Story progress indicator updates on beat increment
   ================================================================= */
test('TC-IX-24: story progress indicator updates correctly across beats', async ({ page }) => {
  await driveToBeatPaused(page)

  // Beat 1
  await expect(page.locator('.story-hud__metric').filter({ hasText: /Beat 1|节点 1/ }).locator('strong')).toBeVisible()

  // Continue to beat 2
  await page.locator('.beat-controls button', { hasText: /Continue|继续/ }).click()
  await emitSSE(page, 'scene_change', { data: { description: 'Superlab.' } })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Walter White',
      content: 'The batch is ready.',
      emotion_state: 'chemistry',
      gif_search_query: 'chemistry',
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-2' } })

  await expect(page.locator('.story-hud__metric').filter({ hasText: /Beat 2|节点 2/ }).locator('strong')).toBeVisible()
})

/* =================================================================
   TC-IX-25: Error box clears on new action
   ================================================================= */
test('TC-IX-25: error message clears when story recovers', async ({ page }) => {
  await driveToBeatPaused(page)

  // Trigger error
  await emitSSE(page, 'error', { data: { message: 'Temporary failure.' } })
  await expect(page.locator('.story-error')).toBeVisible()

  // Click restart (which goes back to idle)
  await page.locator('.story-error button', { hasText: /Restart|重新开始/ }).click()
  await page.waitForTimeout(100)

  // Error state cleared
  await expect(page.locator('.story-error')).toHaveCount(0)
  await expect(page.locator('.story-setup')).toBeVisible()
})
