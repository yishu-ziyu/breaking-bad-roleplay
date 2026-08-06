import { test, expect, type Page } from '@playwright/test'

/**
 * Cold Open crime-drama path (shell only; no real LLM required).
 *
 * Product flow: crisis → choice → cast → Story shell.
 * Agent Harness is lab-only (?lab=1 / /lab).
 *
 * Local note: if port 5173 is occupied by another Vite app, set
 * PLAYWRIGHT_BASE_URL=http://127.0.0.1:5176 (this repo's common dev port).
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'

/** Must match App.tsx PRODUCT_SURFACE — otherwise migration forces cold open again. */
const PRODUCT_SURFACE = 'v2-cold-open'

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Fresh visit: wipe storage before React mounts so Cold Open is the first screen. */
async function gotoColdOpen(page: Page, path = '/') {
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {
      /* private mode etc. */
    }
  })
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.cold-open')).toBeVisible({ timeout: 15_000 })
}

/**
 * Skip cold open and land in the main app shell.
 * Seeds productSurface so the v2 migration does not reset enteredWorld.
 */
async function seedEnteredWorld(
  page: Page,
  extras: Record<string, unknown> = {},
) {
  await page.addInitScript(
    ({ surface, extra }) => {
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch {
        /* ignore */
      }
      localStorage.setItem('abq_enteredWorld', JSON.stringify(true))
      localStorage.setItem('abq_productSurface', JSON.stringify(surface))
      localStorage.setItem('abq_character', JSON.stringify('walter'))
      localStorage.setItem('abq_view', JSON.stringify('story'))
      for (const [key, value] of Object.entries(extra)) {
        localStorage.setItem(key, JSON.stringify(value))
      }
    },
    { surface: PRODUCT_SURFACE, extra: extras },
  )
}

/**
 * MockEventSource for Story SSE (same contract as sse-story.spec.ts).
 * useStoryStream attaches via addEventListener for typed events.
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
    ;(window as Window & { EventSource: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource
    ;(window as MockWindow).__mockSSE = null
    ;(window as MockWindow).__mockSSEInstances = []
  })
}

async function mockSessionCreate(page: Page, sid = 'cold-open-sid') {
  await page.route('**/api/session/create', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session_id: sid }),
    })
  })
}

async function mockActionEndpoint(page: Page) {
  await page.route('**/api/session/*/action', async (route) => {
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
      const sse = (
        window as Window & { __mockSSE?: { emit: (type: string, data: unknown) => void } }
      ).__mockSSE
      if (sse) sse.emit(type, data)
    },
    { type, data },
  )
}

/* ------------------------------------------------------------------ */
/*  1. Cold open visible after clearing storage                       */
/* ------------------------------------------------------------------ */

test('cold open: crisis copy + three choices, no 8-card char grid', async ({ page }) => {
  await gotoColdOpen(page)

  // Crisis stamp / locale copy (zh or en depending on navigator)
  await expect(page.getByText(/新墨西哥|New Mexico/i)).toBeVisible()
  await expect(page.getByText(/2:13|凌晨/i)).toBeVisible()

  // Three primary crisis choices (bilingual)
  await expect(
    page.getByRole('button', { name: /寻找杰西|Find Jesse/i }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /清理现场|Clean/i }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /打给索尔|Call Saul/i }),
  ).toBeVisible()

  // First screen is crisis, not the 8-card casting grid
  await expect(page.locator('.char-grid')).toHaveCount(0)
  await expect(page.locator('.cold-open__cast')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/*  2. Casting after choice                                           */
/* ------------------------------------------------------------------ */

test('cold open: Find Jesse → cast strip with 4 members', async ({ page }) => {
  await gotoColdOpen(page)

  const findJesse = page.getByRole('button', { name: /寻找杰西|Find Jesse/i })
  await expect(findJesse).toBeVisible()
  await findJesse.click()

  // Casting stage (wait past stage transition animation)
  await expect(page.locator('.cold-open__stage--cast')).toBeVisible({ timeout: 10_000 })
  await expect(
    page.getByText(/你以谁的身份进入|You enter as who/i),
  ).toBeVisible()

  // Compact cast: Walter / Jesse / Saul / Mike (not full 8-card grid)
  const cast = page.locator('.cold-open__cast-member')
  await expect(cast).toHaveCount(4)
  await expect(page.locator('.char-grid')).toHaveCount(0)

  // Named faces present (locale-aware labels / aria)
  await expect(
    page.getByRole('button', { name: /沃尔特|Walter/i }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /杰西|Jesse/i }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /索尔|Saul/i }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /迈克|Mike/i }),
  ).toBeVisible()
})

/* ------------------------------------------------------------------ */
/*  3. Enter story shell (soft-assert; no real LLM)                   */
/* ------------------------------------------------------------------ */

test('cold open: cast Walter leaves cold open into story shell or connection sheet', async ({
  page,
}) => {
  // Stub session APIs so a live connection path does not hang on network.
  await mockSessionCreate(page)
  await mockActionEndpoint(page)
  await page.route('**/api/session/*/stream**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    })
  })

  await gotoColdOpen(page)
  await page.getByRole('button', { name: /寻找杰西|Find Jesse/i }).click()
  await expect(page.locator('.cold-open__stage--cast')).toBeVisible({ timeout: 10_000 })
  await expect(
    page.getByText(/你以谁的身份进入|You enter as who/i),
  ).toBeVisible()

  await page.getByRole('button', { name: /进入角色 沃尔特|Enter as Walter/i }).click()

  // Soft-assert: without canStart stays on cold open with gate; with line enters story.
  // Wait briefly for either transition.
  await page.waitForTimeout(400)
  const leftCold = (await page.locator('.cold-open').count()) === 0
  if (leftCold) {
    await expect(page.locator('.app-shell, .story-panel').first()).toBeVisible({
      timeout: 8_000,
    })
  } else {
    const coldError = page.locator('.cold-open__error, [role="alert"]')
    const connectionSheet = page.locator('.connection-sheet')
    await expect(coldError.or(connectionSheet).first()).toBeVisible({ timeout: 8_000 })
  }
})

/* ------------------------------------------------------------------ */
/*  4. Agent Harness lab-only                                         */
/* ------------------------------------------------------------------ */

test('agent harness hidden on cold open without ?lab=1', async ({ page }) => {
  await gotoColdOpen(page)

  await expect(page.getByText(/Agent 实验台|Agent Lab|Agent Harness/i)).toHaveCount(0)
  await expect(page.locator('.agent-harness__fab')).toHaveCount(0)
  await expect(page.locator('.agent-harness')).toHaveCount(0)
})

test('agent harness hidden after enter without lab; visible with ?lab=1', async ({
  page,
}) => {
  // Path A: entered world, no lab query → no harness FAB
  await seedEnteredWorld(page)
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.cold-open')).toHaveCount(0)
  await expect(page.locator('.app-shell, .story-panel').first()).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.locator('.agent-harness__fab')).toHaveCount(0)
  await expect(page.getByText(/Agent 实验台|Agent Harness \(Book\)/i)).toHaveCount(0)

  // Path B: full navigation to ?lab=1 remounts App so showAgentLab re-reads URL
  await page.goto(`${BASE_URL}/?lab=1`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.agent-harness')).toBeVisible({ timeout: 10_000 })
  await expect(
    page.getByRole('button', { name: /Agent 实验台|Agent Harness/i }),
  ).toBeVisible()
})

/* ------------------------------------------------------------------ */
/*  5. Decision bar at beat_paused (mocked SSE; soft if no model line)*/
/* ------------------------------------------------------------------ */

test('decision bar visible when story reaches beat_paused', async ({ page }) => {
  await installMockEventSource(page)
  await mockSessionCreate(page, 'cold-decision-sid')
  await mockActionEndpoint(page)

  // Skip cold open; land in idle Story setup (same shell users reach after cast)
  await seedEnteredWorld(page, { abq_language: 'en' })
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.cold-open')).toHaveCount(0)

  const setup = page.locator('.story-setup')
  // Without a model line, setup may be blocked by connection sheet — soft skip.
  if ((await setup.count()) === 0) {
    test.info().annotations.push({
      type: 'note',
      description:
        'story-setup not visible (likely connection gate); decision bar covered by sse-story when line available',
    })
    await expect(page.locator('.story-panel, .app-shell').first()).toBeVisible()
    return
  }

  await setup.locator('textarea').fill('New Mexico desert, 2:13 a.m. Find Jesse before dawn.')
  await setup.locator('button').click()

  // If start is blocked (canStart false), no SSE — soft exit
  const sseReady = await page
    .waitForFunction(
      () => (window as Window & { __mockSSE?: unknown }).__mockSSE !== null,
      { timeout: 3_000 },
    )
    .then(() => true)
    .catch(() => false)

  if (!sseReady) {
    test.info().annotations.push({
      type: 'note',
      description:
        'Story stream did not open (connection.canStart false). Shell path still covered by tests 1–4.',
    })
    // Soft: still expect either connection sheet or idle story shell
    const gate =
      (await page.locator('.connection-sheet').isVisible().catch(() => false)) ||
      (await page.locator('.story-panel').isVisible().catch(() => false))
    expect(gate).toBe(true)
    return
  }

  await page.waitForTimeout(30)
  await emitSSE(page, 'status', { data: { message: 'Director online' } })
  await emitSSE(page, 'outline', {
    data: { content: '1. Desert — find Jesse.\n2. RV — face the missing cash.' },
  })
  await emitSSE(page, 'scene_change', {
    data: { description: 'New Mexico desert, night.' },
  })
  await emitSSE(page, 'agent_speak', {
    data: {
      character_id: 'Walter White',
      content: 'Jesse. Where the hell are you?',
      emotion_state: 'tense',
      gif_search_query: 'tense',
    },
  })
  await emitSSE(page, 'beat_ready', { data: { beat_id: 'beat-1', is_final: false } })

  await expect(page.locator('.beat-paused--drama')).toBeVisible()
  await expect(page.locator('.drama-decision')).toBeVisible()
  await expect(page.getByText(/Your move|你的决定/i)).toBeVisible()
})
