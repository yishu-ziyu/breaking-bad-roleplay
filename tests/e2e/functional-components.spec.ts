import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'

async function gotoFresh(page: Page) {
  // Bypass landing screen so tests land directly in the app
  await page.addInitScript(() => {
    window.localStorage.setItem('abq_enteredWorld', 'true')
  })
  await page.goto(BASE_URL)
  await page.waitForLoadState('domcontentloaded')
}

async function sendChatMessage(page: Page, text: string) {
  await page.locator('.composer input').fill(text)
  await page.locator('.composer button[type="submit"]').click()
}

async function seedRawStorage(page: Page, values: Record<string, string>) {
  await page.addInitScript((data) => {
    for (const [key, value] of Object.entries(data)) {
      window.localStorage.setItem(key, value)
    }
  }, { ...values, abq_enteredWorld: 'true' })
  await page.goto(BASE_URL)
  await page.waitForLoadState('domcontentloaded')
}

async function installMockEventSource(page: Page) {
  await page.addInitScript(() => {
    type MockWindow = Window & {
      __mockSSE: { emit: (type: string, data: unknown) => void } | null
    }

    class MockEventSource {
      handlers: Map<string, Array<(e: MessageEvent) => void>> = new Map()
      readyState = 0
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 2

      constructor(public url: string) {
        ;(window as MockWindow).__mockSSE = this
      }

      addEventListener(type: string, fn: (e: MessageEvent) => void) {
        if (!this.handlers.has(type)) this.handlers.set(type, [])
        this.handlers.get(type)!.push(fn)
      }

      close() {
        this.readyState = 2
      }

      emit(type: string, data: unknown) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data)
        const ev = new MessageEvent(type, { data: payload })
        this.handlers.get(type)?.forEach((fn) => fn(ev))
      }
    }

    ;(window as Window & { EventSource: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource
    ;(window as MockWindow).__mockSSE = null
  })
}

async function emitSSE(page: Page, type: string, data: unknown) {
  await page.evaluate(
    ({ type, data }) => {
      const sse = (window as Window & {
        __mockSSE?: { emit: (type: string, data: unknown) => void }
      }).__mockSSE
      if (sse) sse.emit(type, data)
    },
    { type, data },
  )
}

test('FC-1: sidebar controls drive chat request payload and render direct reply', async ({ page }) => {
  let requestBody: Record<string, unknown> | null = null

  await page.route('**/api/chat', async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply_text: 'For a client, I can work with that.',
        emotion_state: 'lawyer',
        gif_search_query: 'lawyer',
        thinking: 'This is exposure with a price tag.',
        tool_executed: null,
        tool_log: null,
        updated_relationship_state: null,
      }),
    })
  })

  await gotoFresh(page)
  await page.locator('.seg-control button:has-text("EN")').click()
  await page.locator('.char-card', { hasText: 'Saul' }).click()
  await page.locator('#relation').selectOption('witness')
  // model selector removed from UI in Loop 3
  await sendChatMessage(page, 'I need representation.')

  await expect(page.locator('.msg--char p', { hasText: 'For a client' })).toBeVisible()
  await expect.poll(() => requestBody).not.toBeNull()
  expect(requestBody).toMatchObject({
    characterId: 'saul',
    userInput: 'I need representation.',
    relation: 'witness',
    mode: 'direct',
    language: 'en',
    llmProvider: 'cliproxy',
  })
})

test('FC-2: chat API failure shows an error and a later send can recover', async ({ page }) => {
  let callCount = 0
  await page.route('**/api/chat', async (route) => {
    callCount += 1
    if (callCount === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal server error.' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply_text: 'Now we are talking.',
        emotion_state: 'tense',
        gif_search_query: 'tense',
        thinking: '',
        tool_executed: null,
        tool_log: null,
        updated_relationship_state: null,
      }),
    })
  })

  await gotoFresh(page)
  await sendChatMessage(page, 'First try.')
  await expect(page.locator('.error-box')).toContainText('Internal server error')

  await sendChatMessage(page, 'Second try.')
  await expect(page.locator('.msg--char p', { hasText: 'Now we are talking.' })).toBeVisible()
})

test('FC-3: Story Stop sends stop action, clears saved session, and returns to idle setup', async ({ page }) => {
  const actionLog: Array<Record<string, unknown>> = []

  await installMockEventSource(page)
  // Register routes BEFORE navigation so they intercept API calls
  await page.route('**/api/session/create', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session_id: 'stop-sid' }),
    })
  })
  await page.route('**/api/session/*/action', async (route) => {
    actionLog.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await seedRawStorage(page, {
    abq_view: JSON.stringify('story'),
    abq_language: JSON.stringify('en'),
  })
  await page.locator('.story-setup textarea').fill('Stop after the first beat.')
  await page.locator('.story-setup button').click()
  await page.waitForFunction(() => (window as Window & { __mockSSE?: unknown }).__mockSSE !== null)

  await emitSSE(page, 'outline', { data: { content: '1. RV - cold open' } })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Walter White',
      content: 'This ends here.',
      emotion_state: 'tense',
      gif_search_query: 'tense',
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-1' } })

  await expect(page.locator('.beat-controls')).toBeVisible()
  await page.locator('.beat-controls button', { hasText: /Stop/ }).click()

  await expect.poll(() => actionLog.some((entry) => entry.action === 'stop')).toBe(true)
  await expect(page.locator('.story-setup')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('abq_story_session_id')))
    .toBeNull()
})

test('FC-4: resumed Story history can Continue by opening a fresh SSE connection', async ({ page }) => {
  const actionLog: Array<Record<string, unknown>> = []

  await installMockEventSource(page)
  // Register routes BEFORE navigation
  let messagesRouteHits = 0
  await page.route('**/api/session/resume-sid/messages*', async (route) => {
    messagesRouteHits += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'm1',
          session_id: 'resume-sid',
          role: 'assistant',
          content: 'Restored line.',
          character_name: 'Walter White',
          emotion_state: 'tense',
          gif_search_query: 'tense',
          beat_id: 'beat-1',
          created_at: '2026-07-01T00:00:00',
        },
      ]),
    })
  })
  await page.route('**/api/session/*/action', async (route) => {
    actionLog.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await seedRawStorage(page, {
    abq_story_session_id: 'resume-sid',
    abq_view: JSON.stringify('story'),
    abq_language: JSON.stringify('en'),
  })
  await expect.poll(() => messagesRouteHits).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.story-event--agent_speak p', { hasText: 'Restored line.' })).toBeVisible()
  await expect(page.locator('.beat-controls')).toBeVisible()

  await page.locator('.beat-controls button', { hasText: /Continue/ }).click()
  await expect.poll(() => actionLog.some((entry) => entry.action === 'continue')).toBe(true)
  await expect
    .poll(() => page.evaluate(() => Boolean((window as Window & { __mockSSE?: unknown }).__mockSSE)))
    .toBe(true)

  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Jesse Pinkman',
      content: 'We are back online.',
      emotion_state: 'tense',
      gif_search_query: 'tense',
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-2' } })

  await expect(page.locator('.story-event--agent_speak p', { hasText: 'back online' })).toBeVisible()
})
