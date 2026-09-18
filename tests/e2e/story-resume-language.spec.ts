import { test, expect, type Page } from '@playwright/test'
import { installCommonApi } from './commonApi'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'
const SESSION_ID = 'resume-lang-sid'

/**
 * T8: the three resume notices must speak the interface language.
 *  1. saved session gone  → expired toast
 *  2. session could not be verified → retry toast
 *  3. saved session failed to load  → plain failure card with retry
 * A Chinese interface must never show the old hard-coded English strings.
 */

/** Entered-world story view with a saved session id; language is seeded. */
async function seedSavedStory(page: Page, language: 'zh' | 'en'): Promise<void> {
  await page.addInitScript(({ language, sid }) => {
    window.localStorage.setItem('abq_enteredWorld', JSON.stringify(true))
    window.localStorage.setItem('abq_productSurface', JSON.stringify('v3-mode-door'))
    window.localStorage.setItem('abq_knowledgeTrack', JSON.stringify('fan'))
    window.localStorage.setItem('abq_language', JSON.stringify(language))
    window.localStorage.setItem('abq_surface', JSON.stringify('story'))
    window.localStorage.setItem('abq_storyCharacter', JSON.stringify('walter'))
    window.localStorage.setItem('abq_story_session_id', sid)
    // T10: a stored Story surface is reclaimed for visitors pre-paint and the
    // cold open would hide these notices. The resume flow is author-only now.
    window.localStorage.setItem('yishu_authoring_mode', '1')
  }, { language, sid: SESSION_ID })
  await page.goto(BASE_URL)
  await page.waitForLoadState('domcontentloaded')
}

test.beforeEach(async ({ page }) => {
  await installCommonApi(page)
})

test('T8-1: zh interface + deleted saved session → Chinese expired toast', async ({ page }) => {
  await page.route(`**/api/session/${SESSION_ID}/messages*`, route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'session not found' }),
  }))
  await seedSavedStory(page, 'zh')

  const notice = page.locator('.resume-notice')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('上次的剧情已经不在了')
  await expect(notice).not.toContainText('Your last session expired')
  await expect(page.locator('.story-hud__lang button.is-active')).toHaveText('中文')
})

test('T8-2: en interface + deleted saved session → English expired toast', async ({ page }) => {
  await page.route(`**/api/session/${SESSION_ID}/messages*`, route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'session not found' }),
  }))
  await seedSavedStory(page, 'en')

  const notice = page.locator('.resume-notice')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Your last session expired')
  await expect(notice).not.toContainText('上次的剧情已经不在了')
})

test('T8-3: zh interface + unreachable server → Chinese retry toast', async ({ page }) => {
  await page.route(`**/api/session/${SESSION_ID}/messages*`, route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'temporarily unavailable' }),
  }))
  await seedSavedStory(page, 'zh')

  const notice = page.locator('.resume-notice')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('没法确认上次的剧情')
  await expect(notice).not.toContainText('Could not verify your last session')
})

test('T8-3b: en interface + unreachable server → English retry toast', async ({ page }) => {
  await page.route(`**/api/session/${SESSION_ID}/messages*`, route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'temporarily unavailable' }),
  }))
  await seedSavedStory(page, 'en')

  const notice = page.locator('.resume-notice')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Could not verify your last session')
  await expect(notice).not.toContainText('没法确认上次的剧情')
})

test('T8-4: switching the interface to EN before the probe answers gives the English toast', async ({ page }) => {
  // Delay the probe so the language switch happens first; the notice must
  // follow the live UI language, not the language the page started in.
  await page.route(`**/api/session/${SESSION_ID}/messages*`, async route => {
    await new Promise(resolve => setTimeout(resolve, 1500))
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'session not found' }),
    })
  })
  await seedSavedStory(page, 'zh')

  await page.locator('.story-hud__lang button', { hasText: 'EN' }).click()

  const notice = page.locator('.resume-notice')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Your last session expired')
})

test('T8-5: zh interface + saved session that fails to load → Chinese plain card, retry reloads it', async ({ page }) => {
  let stateStatus = 500
  await page.route(`**/api/session/${SESSION_ID}/state`, route => route.fulfill({
    status: stateStatus,
    contentType: 'application/json',
    body: stateStatus === 200
      ? JSON.stringify({ runtime_version: 0 })
      : JSON.stringify({ detail: 'Internal Server Error' }),
  }))
  await page.route(`**/api/session/${SESSION_ID}/messages*`, route => {
    const url = route.request().url()
    if (url.includes('limit=1')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'm1',
          session_id: SESSION_ID,
          role: 'assistant',
          content: 'Restored line.',
          character_name: 'Walter White',
          emotion_state: 'tense',
          gif_search_query: null,
          beat_id: 'beat-1',
          created_at: '2026-07-01T00:00:00',
        },
      ]),
    })
  })
  await seedSavedStory(page, 'zh')

  const card = page.locator('.story-failure')
  await expect(card).toBeVisible()
  await expect(card).toContainText('上次的剧情没能打开')
  await expect(card).toContainText('重试')
  await expect(card).not.toContainText('Failed to restore story state')

  // Retry = load the same saved session again, never a new story.
  stateStatus = 200
  await page.locator('.story-failure__retry').click()
  await expect(page.locator('.story-manuscript__dialogue', { hasText: 'Restored line.' })).toBeVisible()
  await expect(page.locator('.story-failure')).toHaveCount(0)
})

test('T8-6: en interface + saved session that fails to load → English plain card', async ({ page }) => {
  await page.route(`**/api/session/${SESSION_ID}/state`, route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'temporarily unavailable' }),
  }))
  await page.route(`**/api/session/${SESSION_ID}/messages*`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }))
  await seedSavedStory(page, 'en')

  const card = page.locator('.story-failure')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Could not open your last story')
  await expect(card).toContainText('Retry')
  await expect(card).not.toContainText('Failed to restore story state')
})
