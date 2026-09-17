import { test, expect, type Page } from '@playwright/test'
import { installMockEventSource, expectDirectorControls } from './mockSse'
import { installCommonApi } from './commonApi'

const PRODUCT_SURFACE = 'v3-mode-door'

async function seedSurface(
  page: Page,
  surface: 'story' | 'direct' | 'crew',
  extra: Record<string, unknown> = {},
) {
  await page.addInitScript(({ mode, values, productSurface }) => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('abq_enteredWorld', JSON.stringify(true))
    localStorage.setItem('abq_productSurface', JSON.stringify(productSurface))
    localStorage.setItem('abq_surface', JSON.stringify(mode))
    localStorage.setItem('abq_character', JSON.stringify('walter'))
    localStorage.setItem('abq_language', JSON.stringify('en'))
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(key, JSON.stringify(value))
    }
  }, { mode: surface, values: extra, productSurface: PRODUCT_SURFACE })
}

async function emit(page: Page, type: string, data: Record<string, unknown>) {
  await page.evaluate(({ eventType, payload }) => {
    const sse = (window as Window & {
      __mockSSE?: { emit: (type: string, value: unknown) => void }
    }).__mockSSE
    sse?.emit(eventType, { data: payload })
  }, { eventType: type, payload: data })
}

async function driveModernStoryToPause(
  page: Page,
  actionHandler?: (route: Parameters<Parameters<Page['route']>[1]>[0]) => Promise<void>,
) {
  await installMockEventSource(page)
  await installCommonApi(page)
  await seedSurface(page, 'story')
  await page.route('**/api/session/create', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      session_id: 'current-interactions-story',
      session_key: 'test-session-key',
      runtime_version: 1,
      world_revision: 0,
      command_id: 'opening',
    }),
  }))
  await page.route('**/api/session/*/action', async route => {
    if (actionHandler) {
      await actionHandler(route)
      return
    }
    const body = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        runtime_version: 1,
        world_revision: 1,
        command_id: body.command_id,
      }),
    })
  })

  await page.goto('/')
  await page.locator('.story-setup textarea').fill('A tense meeting beside the RV.')
  await page.locator('.story-setup button').click()
  await page.waitForFunction(() => Boolean((window as Window & { __mockSSE?: unknown }).__mockSSE))
  await emit(page, 'outline', { content: '1. RV — pressure rises' })
  await emit(page, 'scene_change', {
    from_scene: 'desert',
    to_scene: 'rv',
    description: 'The RV sits under a hard desert moon.',
    event_id: 'opening:0',
  })
  await emit(page, 'agent_speak', {
    character_id: 'Jesse Pinkman',
    content: 'Then say what you came to say.',
    emotion_state: 'tense',
    event_id: 'opening:1',
  })
  await emit(page, 'beat_ready', {
    beat_id: 'beat_1',
    command_id: 'opening',
    world_revision: 1,
    player_actor_id: 'walter',
    is_final: false,
    event_id: 'opening:2',
  })
  await expect(page.locator('.beat-paused--drama')).toBeVisible()
}

test('accepted Story action hides every control while the command is pending', async ({ page }) => {
  const actions: Array<Record<string, unknown>> = []
  await driveModernStoryToPause(page, async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    actions.push(body)
    await new Promise(resolve => setTimeout(resolve, 500))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        runtime_version: 1,
        world_revision: 1,
        command_id: body.command_id,
      }),
    })
  })

  await page.locator('.drama-decision input').fill('Give Jesse the phone.')
  await page.locator('.drama-decision button[type="submit"]').click()
  await expect(page.locator('.beat-paused--drama')).toHaveCount(0)
  await expect(page.locator('.streaming-indicator')).toBeVisible()
  await page.waitForTimeout(600)

  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({
    action: 'act',
    player_input: 'Give Jesse the phone.',
    player_kind: 'free',
    expected_revision: 1,
  })
})

test('Direct send swaps the submit button for a working Stop control', async ({ page }) => {
  await installCommonApi(page)
  await seedSurface(page, 'direct', {
    abq_messages: {
      'chat-v2:direct:walter': [{
        id: 'opener-walter',
        sender: 'walter',
        text: 'Choose your words carefully.',
        emotion: 'tense',
        gifQuery: null,
        gifUrl: null,
      }],
    },
  })
  await page.route('**/api/chat', async route => {
    await new Promise(resolve => setTimeout(resolve, 500))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reply_text: 'We always talk.', emotion_state: 'tense' }),
    })
  })

  await page.goto('/')
  const input = page.locator('.composer textarea')
  await input.fill('Test message')
  await page.locator('.composer button[type="submit"]').click()

  const stop = page.locator('.composer__stop')
  await expect(stop).toBeVisible()
  await expect(stop).toContainText(/Stop|停止/)
  await expect(page.locator('.composer button[type="submit"]')).toHaveCount(0)
  await page.waitForTimeout(600)
  await expect(page.locator('.composer button[type="submit"]')).toBeDisabled()
})

test('Story controls remain keyboard-focusable with a visible focus treatment', async ({ page }) => {
  await driveModernStoryToPause(page)
  await expectDirectorControls(page)
  const button = page.locator('.beat-controls button', { hasText: /Continue|继续/ })
  await button.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(button).toBeFocused()
  expect(await button.evaluate(element => getComputedStyle(element).cursor)).toBe('pointer')
  const focusIsVisible = await button.evaluate(element => {
    const style = getComputedStyle(element)
    return style.outlineStyle !== 'none' || style.boxShadow !== 'none'
  })
  expect(focusIsVisible).toBe(true)
})

test('Story setup is removed as soon as a new session starts connecting', async ({ page }) => {
  await installMockEventSource(page)
  await installCommonApi(page)
  await seedSurface(page, 'story')
  await page.route('**/api/session/create', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      session_id: 'connecting-story',
      session_key: 'key',
      runtime_version: 1,
      world_revision: 0,
      command_id: 'opening',
    }),
  }))

  await page.goto('/')
  await page.locator('.story-setup textarea').fill('A new scene.')
  await page.locator('.story-setup button').click()
  await expect(page.locator('.story-setup')).toHaveCount(0)
  await expect(page.locator('.story-status')).toBeVisible()
})

test('an SSE stream that closes without a terminal event retries once, then fails', async ({ page }) => {
  await installMockEventSource(page)
  await installCommonApi(page)
  await seedSurface(page, 'story')
  await page.route('**/api/session/create', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      session_id: 'unexpected-close-story',
      session_key: 'key',
      runtime_version: 1,
      world_revision: 0,
      command_id: 'opening',
    }),
  }))

  await page.goto('/')
  await page.locator('.story-setup textarea').fill('A scene that loses its stream.')
  await page.locator('.story-setup button').click()
  type MockWindow = Window & {
    __mockSSE?: { close: () => void }
    __mockSSEInstances?: Array<{ close: () => void }>
  }
  const closeCurrentStream = () => page.evaluate(() => {
    (window as unknown as MockWindow).__mockSSE?.close()
  })
  await page.waitForFunction(() => Boolean((window as unknown as MockWindow).__mockSSE))
  await closeCurrentStream()

  // P0: a connection that closes before any event is retried once (this is the
  // manual-reconnect window too). Only the second failure is an error — and
  // there is no third attempt, so the player never waits on a hidden loop.
  await page.waitForFunction(
    () => ((window as unknown as MockWindow).__mockSSEInstances?.length ?? 0) >= 2,
  )
  await closeCurrentStream()

  await expect(page.locator('.story-error')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('.story-error')).toContainText(/connection.*(closed|dropped)|断开/i)
  await page.waitForTimeout(1_200)
  expect(await page.evaluate(() => (window as unknown as MockWindow).__mockSSEInstances?.length ?? 0)).toBe(2)
})

test('accepted Story perspective changes the player but never the independent chat partner', async ({ page }) => {
  await driveModernStoryToPause(page)
  await expectDirectorControls(page)
  await page.locator('.beat-controls button', { hasText: /Switch Perspective|切换视角/ }).click()
  await page.locator('.perspective-control select').selectOption('jesse')
  await emit(page, 'agent_speak', {
    character_id: 'Walter White',
    content: 'Then you make the call.',
    emotion_state: 'tense',
    event_id: 'switch-to-jesse:0',
  })
  await emit(page, 'beat_ready', {
    beat_id: 'beat_2',
    command_id: 'switch-to-jesse',
    world_revision: 2,
    player_actor_id: 'jesse',
    is_final: false,
    event_id: 'switch-to-jesse:1',
  })

  await expect(page.locator('.beat-paused--drama')).toBeVisible()
  await expect(page.locator('.story-hud')).toContainText('Jesse')
  await page.getByRole('button', { name: /Direct|单聊/ }).first().click()
  await expect(page.locator('.chat-header h2')).toContainText('Walter')
})

test('IME candidate confirmation never sends the Direct message', async ({ page }) => {
  let calls = 0
  await installCommonApi(page)
  await seedSurface(page, 'direct', {
    abq_language: 'zh',
    abq_messages: {
      'chat-v2:direct:walter': [{
        id: 'opener-walter', sender: 'walter', text: '说话小心点。',
        emotion: 'tense', gifQuery: null, gifUrl: null,
      }],
    },
  })
  await page.route('**/api/chat', async route => {
    calls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ reply_text: '嗯。', emotion_state: 'tense' }),
    })
  })

  await page.goto('/')
  const input = page.locator('.composer textarea')
  await input.fill('老白')
  await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true })
  await page.waitForTimeout(150)
  expect(calls).toBe(0)
  await expect(input).toHaveValue('老白')
  await input.press('Enter')
  await expect.poll(() => calls).toBe(1)
})

test('failed Direct send rolls back the bubble and restores the exact draft', async ({ page }) => {
  await installCommonApi(page)
  await seedSurface(page, 'direct', {
    abq_messages: {
      'chat-v2:direct:walter': [{
        id: 'opener-walter', sender: 'walter', text: 'Choose your words carefully.',
        emotion: 'tense', gifQuery: null, gifUrl: null,
      }],
    },
  })
  await page.route('**/api/chat', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'Model overloaded' }),
  }))

  await page.goto('/')
  const draft = 'We need to talk about the batch.'
  const input = page.locator('.composer textarea')
  await input.fill(draft)
  await page.locator('.composer button[type="submit"]').click()

  await expect(page.locator('.chat-footer .error-box')).toContainText('Model overloaded')
  await expect(page.locator('.msg--user')).toHaveCount(0)
  await expect(input).toHaveValue(draft)
  await expect(page.locator('.composer button[type="submit"]')).toBeEnabled()
})
