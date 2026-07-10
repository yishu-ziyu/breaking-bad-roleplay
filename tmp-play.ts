import { chromium } from '@playwright/test'
import { promises as fs } from 'fs'

const BASE = 'http://localhost:5173'

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  // Pre-install MockEventSource before any page script runs
  await page.addInitScript(() => {
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
      }
      addEventListener(type: string, fn: (e: MessageEvent) => void) {
        if (!this.handlers.has(type)) this.handlers.set(type, [])
        this.handlers.get(type)!.push(fn)
      }
      removeEventListener(type: string, fn: (e: MessageEvent) => void) {
        const arr = this.handlers.get(type)
        if (arr) { const idx = arr.indexOf(fn); if (idx >= 0) arr.splice(idx, 1) }
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
    ;(window as any).EventSource = MockEventSource as any
    ;(window as any).__mockSSE = null
  })

  await page.route('**/api/session/create', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session_id: 'r1-ix' }) })
  })

  const actionLog: Array<Record<string, unknown>> = []
  await page.route('**/api/session/*/action', async (route) => {
    const body = await route.request().postDataJSON()
    actionLog.push(body)
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  // ================================================================
  // Step 1: Landing
  console.log('=== Step 1: Landing ===')
  await page.goto(BASE)
  await page.waitForLoadState('domcontentloaded')
  await sleep(500)
  await page.screenshot({ path: '/tmp/bbr-r1-ix-1.png' })

  // ================================================================
  // Step 2: Inject localStorage + reload
  console.log('=== Step 2: Inject localStorage + reload ===')
  await page.evaluate(() => {
    localStorage.setItem('abq_enteredWorld', 'true')
    localStorage.setItem('abq_sessionId', 'play-r1-ix')
  })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await sleep(1000)
  await page.screenshot({ path: '/tmp/bbr-r1-ix-2.png' })

  console.log(`  App shell visible: ${(await page.locator('.app-shell').count()) > 0}`)

  // ================================================================
  // Step 3: Switch to Chinese + Story view
  console.log('=== Step 3: Switch to Chinese + Story view ===')
  const zhBtn = page.locator('.seg-control button', { hasText: /中文/ })
  if (await zhBtn.count() > 0) {
    await zhBtn.click()
    await sleep(200)
  }

  const storyViewBtn = page.locator('.seg-control button', { hasText: /剧情|Story/ })
  if (await storyViewBtn.count() > 0) {
    await storyViewBtn.click()
    await sleep(200)
  }
  await page.screenshot({ path: '/tmp/bbr-r1-ix-3.png' })

  await page.locator('.story-setup').waitFor({ timeout: 5000 }).catch(() => {})
  await sleep(200)

  console.log(`  Start button text: "${await page.locator('.story-setup button').textContent()}"`)

  // ================================================================
  // Step 4: Empty prompt
  console.log('=== Step 4: Empty prompt ===')
  const emptyBtn = page.locator('.story-setup button')
  console.log(`  Start button disabled with empty prompt: ${await emptyBtn.isDisabled()}`)
  await page.screenshot({ path: '/tmp/bbr-r1-ix-4.png' })

  // ================================================================
  // Step 5: Fill prompt and start (mock SSE)
  console.log('=== Step 5: Fill and start story (mock SSE) ===')
  await page.locator('.story-setup textarea').fill('Walter 需要拿到新的甲胺供应，同时不能让 Skyler 发现。')
  await sleep(100)
  console.log(`  Start button disabled with filled prompt: ${await emptyBtn.isDisabled()}`)

  await emptyBtn.click()
  await sleep(500)
  await page.screenshot({ path: '/tmp/bbr-r1-ix-5.png' })

  // Check: the real SSE will try to connect but MockEventSource won't actually connect.
  // We should see the story-setup disappear (connecting state) and the app will
  // eventually hit an error or just hang. For our QA purposes, we'll note what happens
  // and then reload with seed data to test the full flow.
  const storyStatusVisible = (await page.locator('.story-status').count()) > 0
  const storySetupVisible = (await page.locator('.story-setup').count()) > 0
  const storyErrorVisible = (await page.locator('.story-error').count()) > 0
  console.log(`  Connecting state visible: ${storyStatusVisible}`)
  console.log(`  Story setup still visible: ${storySetupVisible}`)
  console.log(`  Error state visible: ${storyErrorVisible}`)

  // ================================================================
  // Phase B: Full story flow with proper seed + mocks
  // ================================================================
  console.log('\n=== Phase B: Full story flow ===')

  // Seed localStorage for direct entry into story view
  await page.evaluate(() => {
    localStorage.setItem('abq_enteredWorld', 'true')
    localStorage.setItem('abq_character', 'walter')
    localStorage.setItem('abq_language', 'zh')
    localStorage.setItem('abq_view', 'story')
  })

  // Use goto (not reload) so addInitScript mocks apply fresh
  await page.goto(BASE)
  await page.waitForLoadState('domcontentloaded')
  await sleep(500)

  // Set language + view again (React re-reads localStorage on mount)
  const zhBtn2 = page.locator('.seg-control button', { hasText: /中文/ })
  if (await zhBtn2.count() > 0) { await zhBtn2.click(); await sleep(100) }
  const svBtn2 = page.locator('.seg-control button', { hasText: /剧情|Story/ })
  if (await svBtn2.count() > 0) { await svBtn2.click(); await sleep(100) }

  await page.locator('.story-setup').waitFor({ timeout: 5000 }).catch(() => {})
  await sleep(200)

  // Verify mock SSE
  const mockReady = await page.evaluate(() => (window as any).__mockSSE !== null)
  console.log(`  Mock SSE ready: ${mockReady}`)

  // Fill and start
  await page.locator('.story-setup textarea').fill('Walter 需要拿到新的甲胺供应，同时不能让 Skyler 发现。')
  await page.locator('.story-setup button').click()

  await page.waitForFunction(() => (window as any).__mockSSE !== null, { timeout: 5000 }).catch(() => {})
  await sleep(50)

  const instantiated = await page.evaluate(() => (window as any).__mockSSE !== null)
  console.log(`  Mock SSE instantiated: ${instantiated}`)

  if (!instantiated) {
    console.log('  FAILED: MockEventSource not instantiated. Cannot proceed.')
    console.log('\n=== Console Errors ===')
    consoleErrors.forEach(e => console.log(`  ${e}`))
    await browser.close()
    return
  }

  // ================================================================
  // Step 6: Drive to beat_paused
  console.log('=== Step 6: Drive to beat_paused ===')
  await page.evaluate(() => {
    const sse = (window as any).__mockSSE
    if (!sse) return
    sse.emit('status', { data: { message: 'Director online' } })
    sse.emit('outline', { data: { content: '1. Los Pollos 办公室 — Gus 测试 Walter\n2. 地下实验室 — Walter 必须选边站' } })
    sse.emit('scene_change', { data: { description: 'Los Pollos Hermanos 办公室，夜晚。' } })
    sse.emit('agent_speak', {
      data: {
        character_id: 'Walter White',
        content: '我们需要做一批，而且必须马上开始。',
        emotion_state: 'chemistry',
        gif_search_query: 'chemistry',
      },
    })
    sse.emit('world_state_delta', { data: { deltas: [{ target: 'Walter', field: 'stress', old_value: 'low', new_value: 'high' }] } })
    sse.emit('beat_ready', { data: { beat_id: 'beat-1' } })
  })
  await sleep(500)
  await page.screenshot({ path: '/tmp/bbr-r1-ix-6.png' })

  const beatControlsVisible = await page.locator('.beat-controls').count()
  console.log(`\n=== Step 6: beat_paused ===`)
  console.log(`  BeatControls visible: ${beatControlsVisible > 0}`)

  if (beatControlsVisible > 0) {
    // ================================================================
    // Step 7: Continue
    console.log('=== Step 7: Continue ===')
    await page.locator('.beat-controls button', { hasText: /继续|Continue/ }).click()
    await sleep(100)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-7.png' })
    const streamingAfterContinue = await page.locator('.streaming-indicator').count()
    console.log(`  Streaming indicator after continue: ${streamingAfterContinue > 0}`)
    const bcAfterContinue = await page.locator('.beat-controls').count()
    console.log(`  BeatControls hidden after continue: ${bcAfterContinue === 0}`)

    await page.evaluate(() => {
      const sse = (window as any).__mockSSE
      if (!sse) return
      sse.emit('scene_change', { data: { description: '地下超级实验室。' } })
      sse.emit('agent_speak', { data: { character_id: 'Walter White', content: '这批货准备好了。', emotion_state: 'chemistry', gif_search_query: 'chemistry' } })
      sse.emit('beat_ready', { data: { beat_id: 'beat-2' } })
    })
    await sleep(500)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-8.png' })
    console.log(`  BeatControls visible after beat-2: ${(await page.locator('.beat-controls').count()) > 0}`)

    // ================================================================
    // Step 8: Stop
    console.log('=== Step 8: Stop ===')
    await page.locator('.beat-controls button', { hasText: /停止|Stop/ }).click()
    await sleep(300)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-9.png' })
    const setupAfterStop = await page.locator('.story-setup').count()
    console.log(`  Story setup visible after stop: ${setupAfterStop > 0}`)

    // ================================================================
    // Step 9: Restart for redirect
    console.log('=== Step 9: Restart for redirect ===')
    await page.locator('.story-setup textarea').fill('Walter 需要拿到新的甲胺供应。')
    await page.locator('.story-setup button').click()
    await page.waitForFunction(() => (window as any).__mockSSE !== null, { timeout: 5000 }).catch(() => {})
    await sleep(50)
    await page.evaluate(() => {
      const sse = (window as any).__mockSSE
      if (!sse) return
      sse.emit('status', { data: { message: 'Director online' } })
      sse.emit('outline', { data: { content: '1. 获取甲胺\n2. 制作毒品' } })
      sse.emit('scene_change', { data: { description: 'Los Pollos。' } })
      sse.emit('agent_speak', { data: { character_id: 'Walter White', content: '开始吧。', emotion_state: 'tense', gif_search_query: 'tense' } })
      sse.emit('world_state_delta', { data: { deltas: [{ target: 'Walter', field: 'stress', old_value: 'low', new_value: 'high' }] } })
      sse.emit('beat_ready', { data: { beat_id: 'beat-1' } })
    })
    await sleep(500)

    // Redirect
    console.log('  -- Redirect --')
    await page.locator('.beat-controls button', { hasText: /重定向|Redirect/ }).click()
    await sleep(100)
    await page.locator('.redirect-control input').fill('Walter 决定背叛 Gus。')
    await page.locator('.redirect-control button', { hasText: /提交|Submit/ }).click()
    await sleep(100)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-10.png' })
    const streamingAfterRedirect = await page.locator('.streaming-indicator').count()
    console.log(`  Streaming indicator after redirect: ${streamingAfterRedirect > 0}`)

    await page.evaluate(() => {
      const sse = (window as any).__mockSSE
      if (!sse) return
      sse.emit('outline', { data: { content: '1. 暗杀 Gus\n2. 接管帝国' } })
      sse.emit('scene_change', { data: { description: "Jesse 的房子。" } })
      sse.emit('agent_speak', { data: { character_id: 'Walter White', content: '我们必须除掉他。', emotion_state: 'tense', gif_search_query: 'tense' } })
      sse.emit('beat_ready', { data: { beat_id: 'beat-1' } })
    })
    await sleep(500)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-11.png' })

    // ================================================================
    // Step 10: Switch Perspective
    console.log('=== Step 10: Switch Perspective ===')
    await page.locator('.beat-controls button', { hasText: /切换视角|Switch Perspective/ }).click()
    await sleep(100)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-12.png' })
    console.log(`  Perspective select visible: ${(await page.locator('.perspective-control select').count()) > 0}`)

    await page.locator('.perspective-control select').selectOption('jesse')
    await sleep(100)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-13.png' })
    const streamingAfterSwitch = await page.locator('.streaming-indicator').count()
    console.log(`  Streaming indicator after switch perspective: ${streamingAfterSwitch > 0}`)

    await page.evaluate(() => {
      const sse = (window as any).__mockSSE
      if (!sse) return
      sse.emit('scene_change', { data: { description: "Jesse 的房子。" } })
      sse.emit('agent_speak', { data: { character_id: 'Jesse Pinkman', content: 'Yo, Mr. White, 现在怎么办？', emotion_state: 'anxious', gif_search_query: 'anxious' } })
      sse.emit('agent_speak', { data: { character_id: 'Walter White', content: '等待。', emotion_state: 'tense', gif_search_query: 'tense' } })
      sse.emit('beat_ready', { data: { beat_id: 'beat-2' } })
    })
    await sleep(500)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-14.png' })

    // ================================================================
    // Step 11: Complete
    console.log('=== Step 11: Complete state ===')
    await page.evaluate(() => {
      const sse = (window as any).__mockSSE
      if (!sse) return
      sse.emit('complete', { data: { message: '故事到达了终点。' } })
    })
    await sleep(300)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-15.png' })
    console.log(`  Story complete visible: ${(await page.locator('.story-complete').count()) > 0}`)

    // ================================================================
    // Step 12: Error state
    console.log('=== Step 12: Error state ===')
    await page.locator('.story-complete button', { hasText: /重新开始|Start Again/ }).click()
    await sleep(200)
    await page.locator('.story-setup textarea').fill('Test')
    await page.locator('.story-setup button').click()
    await page.waitForFunction(() => (window as any).__mockSSE !== null, { timeout: 5000 }).catch(() => {})
    await sleep(50)
    await page.evaluate(() => {
      const sse = (window as any).__mockSSE
      if (!sse) return
      sse.emit('status', { data: { message: 'Director online' } })
      sse.emit('outline', { data: { content: '1. 开始' } })
      sse.emit('scene_change', { data: { description: '某处。' } })
      sse.emit('agent_speak', { data: { character_id: 'Walter White', content: '开始。', emotion_state: 'tense', gif_search_query: 'tense' } })
      sse.emit('world_state_delta', { data: { deltas: [{ target: 'Walter', field: 'stress', old_value: 'low', new_value: 'high' }] } })
      sse.emit('beat_ready', { data: { beat_id: 'beat-1' } })
    })
    await sleep(500)

    await page.evaluate(() => {
      const sse = (window as any).__mockSSE
      if (!sse) return
      sse.emit('error', { data: { message: 'SSE 连接断开。' } })
    })
    await sleep(300)
    await page.screenshot({ path: '/tmp/bbr-r1-ix-16.png' })
    console.log(`  Story error visible: ${(await page.locator('.story-error').count()) > 0}`)
  }

  // ================================================================
  // Summary
  console.log('\n=== Console Errors ===')
  if (consoleErrors.length === 0) {
    console.log('  None')
  } else {
    consoleErrors.forEach(e => console.log(`  ${e}`))
  }

  console.log('\n=== Action Log ===')
  actionLog.forEach(e => console.log(`  ${JSON.stringify(e)}`))

  console.log('\n=== Screenshot Check ===')
  for (let i = 1; i <= 16; i++) {
    const path = `/tmp/bbr-r1-ix-${i}.png`
    try { const stat = await fs.stat(path); console.log(`  ${path} (${Math.round(stat.size / 1024)}KB)`) } catch { console.log(`  ${path} MISSING`) }
  }

  await browser.close()
}

main().catch(console.error)
