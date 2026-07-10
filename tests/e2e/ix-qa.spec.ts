import { test, expect, type Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173'

const consoleErrors: string[] = []

function collectErrors(page: Page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))
}

async function gotoFresh(page: Page) {
  await page.goto(BASE_URL)
  await page.waitForLoadState('domcontentloaded')
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

async function installMockEventSource(page: Page) {
  await page.addInitScript(() => {
    type MockWindow = Window & {
      __mockSSE: { emit: (type: string, data: unknown) => void } | null
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
      }
      addEventListener(type: string, fn: (e: MessageEvent) => void) {
        if (!this.handlers.has(type)) this.handlers.set(type, [])
        this.handlers.get(type)!.push(fn)
      }
      removeEventListener(type: string, fn: (e: MessageEvent) => void) {
        const arr = this.handlers.get(type)
        if (arr) { const idx = arr.indexOf(fn); if (idx >= 0) arr.splice(idx, 1) }
      }
      close() { this.readyState = 2 }
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
  })
}

async function mockSessionCreate(page: Page, sid = 'r1-ix') {
  await page.route('**/api/session/create', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session_id: sid }) })
  })
}

async function mockActionEndpoint(page: Page, log: Array<Record<string, unknown>>) {
  await page.route('**/api/session/*/action', async (route) => {
    const body = route.request().postDataJSON()
    log.push(body as Record<string, unknown>)
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

async function driveToBeatPaused(page: Page, opts: { outline?: string; agentSpeak?: string; beatId?: string } = {}): Promise<Array<Record<string, unknown>>> {
  const outline = opts.outline ?? '1. 获取甲胺\n2. 制作毒品'
  const agentSpeak = opts.agentSpeak ?? '开始吧。'
  const beatId = opts.beatId ?? 'beat-1'
  const actionLog: Array<Record<string, unknown>> = []

  await installMockEventSource(page)
  await mockSessionCreate(page, 'r1-ix')
  await mockActionEndpoint(page, actionLog)
  await seedStorage(page, {
    abq_character: 'walter',
    abq_language: 'zh',
    abq_view: 'story',
  })

  await page.locator('.story-setup textarea').fill('Walter 需要拿到新的甲胺供应。')
  await page.locator('.story-setup button').click()

  await page.waitForFunction(
    () => Boolean((window as Window & { __mockSSE?: unknown }).__mockSSE),
    { timeout: 5000 },
  )
  await page.waitForTimeout(30)

  await page.evaluate(
    ({ outline, agentSpeak, beatId }) => {
      const sse = (window as Window & {
        __mockSSE?: { emit: (type: string, data: unknown) => void }
      }).__mockSSE
      if (!sse) return
      sse.emit('status', { data: { message: 'Director online' } })
      sse.emit('outline', { data: { content: outline } })
      sse.emit('scene_change', { data: { description: 'Los Pollos。' } })
      sse.emit('agent_speak', {
        data: {
          character_id: 'Walter White',
          content: agentSpeak,
          emotion_state: 'tense',
          gif_search_query: 'tense',
        },
      })
      sse.emit('world_state_delta', { data: { deltas: [{ target: 'Walter', field: 'stress', old_value: 'low', new_value: 'high' }] } })
      sse.emit('beat_ready', { data: { beat_id: beatId } })
    },
    { outline, agentSpeak, beatId },
  )

  await expect(page.locator('.beat-controls')).toBeVisible()
  return actionLog
}

/* =================================================================
   TEST GROUP: Interaction QA Round 1
   ================================================================= */

test.describe('IX-1: Landing and entry', () => {
  test.beforeEach(() => { consoleErrors.length = 0 })

  test('IX-1: landing enter button visible', async ({ page }) => {
    collectErrors(page)
    await gotoFresh(page)
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-1.png' })

    const enterBtn = page.locator('.landing-screen__enter')
    await expect(enterBtn).toBeVisible()
    await expect(enterBtn).toBeEnabled()
    await expect(enterBtn).toContainText(/ENTER THE WORLD|进入世界/)

    const title = page.locator('.landing-screen__title')
    await expect(title).toBeVisible()
    await expect(page.locator('.landing-step__num')).toHaveCount(3)

    await page.waitForTimeout(500)
    expect(consoleErrors).toEqual([])
  })
})

test.describe('IX-2: App shell and navigation', () => {
  test.beforeEach(() => { consoleErrors.length = 0 })

  test('IX-2: enter world shows app shell', async ({ page }) => {
    collectErrors(page)
    // seedStorage sets abq_enteredWorld=true, so app renders .app-shell directly
    await seedStorage(page, {})
    await page.waitForTimeout(300)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-2.png' })

    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.char-grid')).toBeVisible()
    await expect(page.locator('.char-card')).toHaveCount(6)
    await expect(page.locator('.char-card.selected')).toBeVisible()

    await page.waitForTimeout(500)
    expect(consoleErrors).toEqual([])
  })

  test('IX-3: empty story prompt disables start button', async ({ page }) => {
    collectErrors(page)
    await seedStorage(page, { abq_character: 'walter', abq_language: 'zh', abq_view: 'story' })
    await page.screenshot({ path: '/tmp/bbr-r1-ix-3.png' })

    await expect(page.locator('.story-setup')).toBeVisible()
    await expect(page.locator('.story-setup button')).toBeDisabled()

    // Fill it
    await page.locator('.story-setup textarea').fill('Walter 需要甲胺。')
    await page.waitForTimeout(50)
    await expect(page.locator('.story-setup button')).toBeEnabled()

    await page.waitForTimeout(500)
    expect(consoleErrors).toEqual([])
  })

  test('IX-4: language toggle switches UI text', async ({ page }) => {
    collectErrors(page)
    await seedStorage(page, { abq_character: 'walter', abq_language: 'en', abq_view: 'story' })

    await expect(page.locator('button', { hasText: /Start Story/ })).toBeVisible()

    await page.locator('.seg-control button', { hasText: /中文/ }).click()
    await page.waitForTimeout(100)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-4.png' })

    await expect(page.locator('button', { hasText: /开始任务/ })).toBeVisible()

    await page.locator('.seg-control button', { hasText: /EN/ }).click()
    await page.waitForTimeout(100)
    await expect(page.locator('button', { hasText: /Start Story/ })).toBeVisible()

    expect(consoleErrors).toEqual([])
  })
})

test.describe('IX-3: BeatControls and decision flow', () => {
  test.beforeEach(() => { consoleErrors.length = 0 })

  test('IX-3a: beat_paused shows 4 decision buttons', async ({ page }) => {
    collectErrors(page)
    await driveToBeatPaused(page)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-5.png' })

    const controls = page.locator('.beat-controls')
    await expect(controls.locator('button', { hasText: /继续|Continue/ })).toBeVisible()
    await expect(controls.locator('button', { hasText: /停止|Stop/ })).toBeVisible()
    await expect(controls.locator('button', { hasText: /重定向|Redirect/ })).toBeVisible()
    await expect(controls.locator('button', { hasText: /切换视角|Switch Perspective/ })).toBeVisible()

    expect(consoleErrors).toEqual([])
  })

  test('IX-3b: continue transitions to streaming then next beat', async ({ page }) => {
    collectErrors(page)
    await driveToBeatPaused(page)

    await page.locator('.beat-controls button', { hasText: /继续|Continue/ }).click()
    await page.waitForTimeout(100)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-6.png' })

    // BeatControls hidden, streaming visible
    await expect(page.locator('.beat-controls')).toHaveCount(0)
    await expect(page.locator('.streaming-indicator')).toBeVisible()

    // Emit next beat
    await page.evaluate(() => {
      const sse = (window as Window & {
        __mockSSE?: { emit: (type: string, data: unknown) => void }
      }).__mockSSE
      if (!sse) return
      sse.emit('scene_change', { data: { description: '地下超级实验室。' } })
      sse.emit('agent_speak', { data: { character_id: 'Walter White', content: '这批货准备好了。', emotion_state: 'chemistry', gif_search_query: 'chemistry' } })
      sse.emit('beat_ready', { data: { beat_id: 'beat-2' } })
    })
    await page.waitForTimeout(500)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-7.png' })

    await expect(page.locator('.beat-controls')).toBeVisible()
    // Beat index increments - verified by beat_ready with beat-2

    expect(consoleErrors).toEqual([])
  })

  test('IX-3c: stop clears session and returns to idle', async ({ page }) => {
    collectErrors(page)
    await driveToBeatPaused(page)

    await page.locator('.beat-controls button', { hasText: /停止|Stop/ }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-8.png' })

    await expect(page.locator('.story-setup')).toBeVisible()
    await expect(page.locator('.beat-controls')).toHaveCount(0)

    const savedSid = await page.evaluate(() => localStorage.getItem('abq_story_session_id'))
    expect(savedSid).toBeNull()

    expect(consoleErrors).toEqual([])
  })

  test('IX-3d: redirect opens input, validates, submits', async ({ page }) => {
    collectErrors(page)
    await driveToBeatPaused(page)

    // Open redirect
    await page.locator('.beat-controls button', { hasText: /重定向|Redirect/ }).click()
    await page.waitForTimeout(100)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-9.png' })

    const input = page.locator('.redirect-control input')
    await expect(input).toBeVisible()

    // Submit disabled when empty
    const submitBtn = page.locator('.redirect-control button', { hasText: /提交|Submit/ })
    await expect(submitBtn).toBeDisabled()

    // Fill + submit
    await input.fill('Walter 决定背叛 Gus。')
    await page.waitForTimeout(50)
    await expect(submitBtn).toBeEnabled()

    await submitBtn.click()
    await page.waitForTimeout(100)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-10.png' })

    // Should go to streaming
    await expect(page.locator('.streaming-indicator')).toBeVisible()
    await expect(page.locator('.beat-controls')).toHaveCount(0)

    expect(consoleErrors).toEqual([])
  })

  test('IX-3e: switch perspective opens select, validates, submits', async ({ page }) => {
    collectErrors(page)
    await driveToBeatPaused(page)

    await page.locator('.beat-controls button', { hasText: /切换视角|Switch Perspective/ }).click()
    await page.waitForTimeout(100)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-11.png' })

    const select = page.locator('.perspective-control select')
    await expect(select).toBeVisible()

    await select.selectOption('jesse')
    await page.waitForTimeout(100)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-12.png' })

    // Should go to streaming
    await expect(page.locator('.streaming-indicator')).toBeVisible()
    await expect(page.locator('.beat-controls')).toHaveCount(0)

    expect(consoleErrors).toEqual([])
  })
})

test.describe('IX-4: Terminal states', () => {
  test.beforeEach(() => { consoleErrors.length = 0 })

  test('IX-4a: complete state', async ({ page }) => {
    collectErrors(page)
    await driveToBeatPaused(page)
    await page.evaluate(() => {
      const sse = (window as Window & {
        __mockSSE?: { emit: (type: string, data: unknown) => void }
      }).__mockSSE
      if (!sse) return
      sse.emit('complete', { data: { message: '故事到达了终点。' } })
    })
    await page.waitForTimeout(300)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-13.png' })

    await expect(page.locator('.story-complete')).toBeVisible()
    await expect(page.locator('.beat-controls')).toHaveCount(0)
    await expect(page.locator('.story-complete button', { hasText: /开始第二章/ })).toBeVisible()
    await expect(page.locator('.story-complete button', { hasText: /换一个分支/ })).toBeVisible()
    await expect(page.locator('.story-complete button', { hasText: /重演最后节点/ })).toBeVisible()
    await expect(page.locator('.story-complete button', { hasText: /重新开始/ })).toBeVisible()

    expect(consoleErrors).toEqual([])
  })

  test('IX-4b: error state', async ({ page }) => {
    collectErrors(page)
    await driveToBeatPaused(page)
    await page.evaluate(() => {
      const sse = (window as Window & {
        __mockSSE?: { emit: (type: string, data: unknown) => void }
      }).__mockSSE
      if (!sse) return
      sse.emit('error', { data: { message: 'SSE 连接断开。' } })
    })
    await page.waitForTimeout(300)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-14.png' })

    await expect(page.locator('.story-error')).toBeVisible()
    await expect(page.locator('.story-error')).toContainText('SSE 连接断开')
    await expect(page.locator('.story-error button', { hasText: /重连/ })).toBeVisible()
    await expect(page.locator('.story-error button', { hasText: /重新开始/ })).toBeVisible()
    await expect(page.locator('.beat-controls')).toHaveCount(0)

    expect(consoleErrors).toEqual([])
  })
})

test.describe('IX-5: Additional interaction checks', () => {
  test.beforeEach(() => { consoleErrors.length = 0 })

  test('IX-5a: connecting state visible during story start', async ({ page }) => {
    collectErrors(page)
    await seedStorage(page, { abq_character: 'walter', abq_language: 'zh', abq_view: 'story' })

    await page.locator('.story-setup textarea').fill('Walter 需要拿到新的甲胺供应。')
    await page.locator('.story-setup button').click()

    // Check for connecting state (typing dots + directing text)
    await expect(page.locator('.story-status')).toBeVisible()
    await page.screenshot({ path: '/tmp/bbr-r1-ix-15.png' })

    expect(consoleErrors).toEqual([])
  })

  test('IX-5b: return to landing button', async ({ page }) => {
    collectErrors(page)
    await seedStorage(page, { abq_character: 'walter', abq_language: 'en', abq_view: 'story' })

    await expect(page.locator('.app-shell')).toBeVisible()
    await page.locator('.brand-return').click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-16.png' })

    await expect(page.locator('.landing-screen')).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveCount(0)

    expect(consoleErrors).toEqual([])
  })
})
