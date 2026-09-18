import { test, expect, type Page } from '@playwright/test'
import { installCommonApi } from './commonApi'
import { installMockEventSource } from './mockSse'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

/**
 * T2: a failed story start (POST /api/session/create → 5xx) and a refused beat
 * (`error` event on the stream) must both be visible in plain words, and the
 * retry entry must re-run the SAME opening.
 */

/** Seed an entered-world Chinese story view; no cold-open billboard. */
async function seedStoryZh(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Match the other story specs: productSurface must already be v3, or the
    // pre-paint migration resets enteredWorld and the cold open returns.
    window.localStorage.setItem('abq_enteredWorld', JSON.stringify(true))
    window.localStorage.setItem('abq_productSurface', JSON.stringify('v3-mode-door'))
    window.localStorage.setItem('abq_knowledgeTrack', JSON.stringify('fan'))
    window.localStorage.setItem('abq_language', JSON.stringify('zh'))
    window.localStorage.setItem('abq_surface', JSON.stringify('story'))
    window.localStorage.setItem('abq_storyCharacter', JSON.stringify('walter'))
    // T10: Story is closed to visitors, and a stored Story surface is reclaimed
    // pre-paint. This spec drives the Story board → opt in as an author.
    window.localStorage.setItem('yishu_authoring_mode', '1')
  })
  await page.goto(BASE_URL)
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.story-setup textarea').waitFor({ state: 'visible' })
}

test.beforeEach(async ({ page }) => {
  await installCommonApi(page)
  await installMockEventSource(page)
})

test('T2 /api/session/create 500: plain Chinese notice + retry re-runs the same opening', async ({ page }) => {
  const createBodies: Array<Record<string, unknown>> = []
  let createStatus = 500
  await page.route('**/api/session/create', async (route) => {
    createBodies.push(route.request().postDataJSON() as Record<string, unknown>)
    if (createStatus !== 200) {
      return route.fulfill({
        status: createStatus,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal Server Error' }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session_id: 'sid-retry', runtime_version: 1, world_revision: 0 }),
    })
  })

  await seedStoryZh(page)
  const opening = '房车外的车灯越来越近，杰西还在外面。'
  await page.locator('.story-setup textarea').fill(opening)
  await page.locator('.story-setup button').click()

  const notice = page.locator('.story-failure')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('剧情没能开始')
  await expect(notice).toContainText('同一段开场')
  await expect(notice).not.toContainText('Internal Server Error')
  await expect(page.locator('.story-failure__retry')).toBeVisible()

  // Retry = the same opening again, now that create works.
  createStatus = 200
  await page.locator('.story-failure__retry').click()
  await expect.poll(() => createBodies.length).toBe(2)
  expect(createBodies[1]?.task_prompt).toBe(opening)
  expect(createBodies[1]?.task_prompt).toBe(createBodies[0]?.task_prompt)
  await expect(notice).toHaveCount(0)
  await page.waitForFunction(
    () => (window as Window & { __mockSSE?: unknown }).__mockSSE != null,
  )
})

test('T2 stream error event (beat refused): visible plain notice with retry', async ({ page }) => {
  await page.route('**/api/session/create', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ session_id: 'sid-1', runtime_version: 1, world_revision: 0 }),
  }))

  await seedStoryZh(page)
  await page.locator('.story-setup textarea').fill('开场设定。')
  await page.locator('.story-setup button').click()
  await page.waitForFunction(
    () => (window as Window & { __mockSSE?: unknown }).__mockSSE != null,
  )

  await page.evaluate(() => {
    const hook = (window as Window & {
      __storyHandleEvent?: (type: string, raw: string) => void
    }).__storyHandleEvent
    hook?.('agent_speak', JSON.stringify({
      data: { character_id: 'Jesse Pinkman', content: 'Yo.', emotion_state: 'tense' },
    }))
    hook?.('error', JSON.stringify({
      data: { message: 'beat rejected: beat_ready without committed world revision' },
    }))
  })

  const notice = page.locator('.story-failure')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('这一拍没能继续')
  await expect(notice).toContainText('重试')
  await expect(notice).not.toContainText('beat rejected')
})
