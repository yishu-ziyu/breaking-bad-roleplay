import { test, expect, type Page } from '@playwright/test'
import { installMockEventSource } from './mockSse'
import { installCommonApi } from './commonApi'

/**
 * T10 (product decision 2026-09-18): Story stays closed to visitors.
 *
 * Visitor: the STORY card and the 剧情 button in the play-mode bar show
 * "剧情正在开发中" and do not enter the Story board.
 * Author: `?authoring=1` (persisted in localStorage `yishu_authoring_mode`)
 * keeps the full flow — knowledge question → 场面卡 → story start.
 *
 * Note: both story entries carry `aria-disabled="true"` for assistive tech.
 * Playwright's actionability check refuses normal `.click()` on an
 * aria-disabled element (browsers do not), so the blocked clicks below are
 * real mouse clicks at the element's box — the same thing a user does.
 *
 * Local note: 5173 may be occupied by another app; run with
 * `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5176`.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'
const AUTHORING_KEY = 'yishu_authoring_mode'

test.beforeEach(async ({ page }) => {
  await installCommonApi(page)
})

/**
 * Seed storage once per browser context (addInitScript runs on every
 * navigation, so clearing unconditionally would wipe the app's own keys on the
 * reloads below). `raw` keys are written verbatim — `yishu_authoring_mode` is a
 * plain '1', not JSON.
 */
async function seedStorageOnce(page: Page, language: 'zh' | 'en', raw: Record<string, string> = {}) {
  await page.addInitScript(({ lang, values }) => {
    try {
      if (sessionStorage.getItem('t10-seeded')) return
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('abq_language', JSON.stringify(lang))
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value)
      sessionStorage.setItem('t10-seeded', '1')
    } catch {
      /* private mode etc. */
    }
  }, { lang: language, values: raw })
}

/** Fresh visit with a fixed UI language, no author switch. */
async function gotoFresh(page: Page, language: 'zh' | 'en' = 'zh', path = '/') {
  await seedStorageOnce(page, language)
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' })
}

/**
 * Real mouse click at the centre of a box. Used on aria-disabled controls:
 * Playwright's actionability check refuses those (browsers do not), and unlike
 * `locator.click()` a raw mouse click needs the element scrolled into view.
 */
async function mouseClickCentered(page: Page, locator: ReturnType<Page['locator']>) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  expect(box, 'element must have a box to click').not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
}

/** Story start must never fire while Story is closed. */
async function trackSessionCreate(page: Page) {
  const state = { hits: 0 }
  await page.route('**/api/session/create', async (route) => {
    state.hits += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session_id: 't10-sid' }),
    })
  })
  return state
}

/* ------------------------------------------------------------------ */
/*  1. Visitor: STORY card                                             */
/* ------------------------------------------------------------------ */

test('visitor: STORY card is marked 开发中 and clicking it does not enter Story', async ({
  page,
}) => {
  const create = await trackSessionCreate(page)
  await gotoFresh(page, 'zh')

  const door = page.locator('.cold-open-showcase')
  await expect(door).toBeVisible({ timeout: 15_000 })

  const storyCard = page.locator('.showcase-card--story')
  await expect(storyCard).toHaveAttribute('data-story-open', 'false')
  await expect(page.getByTestId('story-coming-soon')).toHaveText('开发中')

  const urlBeforeClick = page.url()
  await mouseClickCentered(page, storyCard.getByRole('button', { name: /开始故事/ }))

  // Plain-language notice, still on the door, no story surface anywhere.
  await expect(door.locator('.showcase-card--story [role="alert"]')).toContainText('剧情正在开发中')
  await expect(door.locator('.showcase-card--story [role="alert"]')).toContainText('暂时无法进入')
  await expect(page.locator('.showcase-dialog')).toHaveCount(0)
  await expect(page.locator('.story-scene-bill')).toHaveCount(0)
  await expect(page.locator('.story-setup')).toHaveCount(0)
  await expect(page.locator('.story-panel, .story-hud')).toHaveCount(0)
  expect(create.hits).toBe(0)

  // The blocked click changes neither the URL nor the story session storage.
  expect(page.url()).toBe(urlBeforeClick)
  expect(new URL(page.url()).searchParams.get('surface')).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('abq_story_session_id'))).toBeNull()
})

test('visitor: English door gets the English notice', async ({ page }) => {
  await gotoFresh(page, 'en')
  const storyCard = page.locator('.showcase-card--story')
  await expect(storyCard).toHaveAttribute('data-story-open', 'false')
  await expect(page.getByTestId('story-coming-soon')).toHaveText('In development')

  await mouseClickCentered(page, storyCard.getByRole('button', { name: /Start Story/i }))
  await expect(storyCard.locator('[role="alert"]')).toContainText('still in development')
})

/* ------------------------------------------------------------------ */
/*  2. Visitor: play-mode bar                                          */
/* ------------------------------------------------------------------ */

test('visitor: 剧情 in the play-mode bar explains instead of switching', async ({ page }) => {
  const create = await trackSessionCreate(page)
  await gotoFresh(page, 'zh')

  await page.getByRole('button', { name: /选择角色对话/ }).click()
  await expect(page.locator('.chat-panel')).toBeVisible()

  const bar = page.locator('.play-mode-bar')
  const directBtn = bar.getByRole('button', { name: '单聊', exact: true })
  const storyBtn = bar.getByRole('button', { name: '剧情', exact: true })
  await expect(directBtn).toHaveAttribute('aria-pressed', 'true')
  await expect(storyBtn).toHaveAttribute('aria-disabled', 'true')

  await mouseClickCentered(page, storyBtn)

  await expect(page.locator('.play-mode-bar__notice')).toContainText('剧情正在开发中')
  // Still Direct: surface did not change and Story never mounted.
  await expect(directBtn).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.chat-panel')).toBeVisible()
  await expect(page.locator('.story-panel, .story-hud, .story-scene-bill')).toHaveCount(0)
  expect(create.hits).toBe(0)
})

test('visitor: settings drawer cannot switch into Story either', async ({ page }) => {
  await gotoFresh(page, 'zh')

  await page.getByRole('button', { name: /选择角色对话/ }).click()
  await expect(page.locator('.chat-panel')).toBeVisible()

  await page.locator('.archive-settings > summary').click()
  const settings = page.locator('.archive-settings')
  const storyBtn = settings.locator('.seg-control button').filter({ hasText: '剧情' })
  await expect(storyBtn).toHaveAttribute('aria-disabled', 'true')

  await mouseClickCentered(page, storyBtn)

  await expect(settings.locator('.story-coming-soon')).toContainText('剧情正在开发中')
  await expect(page.locator('.chat-panel')).toBeVisible()
  await expect(page.locator('.story-panel, .story-hud')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/*  3. Author: Story still opens                                       */
/* ------------------------------------------------------------------ */

test('author: ?authoring=1 enters Story, survives reload, and starts the opening', async ({
  page,
}) => {
  await installMockEventSource(page)
  const create = await trackSessionCreate(page)
  await page.route('**/api/session/*/action', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )

  await gotoFresh(page, 'zh', '/?authoring=1')
  const storyCard = page.locator('.showcase-card--story')
  await expect(storyCard).toHaveAttribute('data-story-open', 'true', { timeout: 15_000 })
  await expect(page.getByTestId('story-coming-soon')).toHaveCount(0)

  // Door → knowledge question → 场面卡 (same path as before the closure).
  await storyCard.getByRole('button', { name: /开始故事/ }).click()
  await page.getByRole('button', { name: /看过 · 直入危机/ }).click()
  await expect(page.locator('.cold-open-showcase')).toHaveCount(0)
  await expect(page.locator('.story-scene-bill')).toBeVisible({ timeout: 10_000 })
  expect(create.hits).toBe(0)

  // 开局: the scene card's start button opens the session.
  await page.getByRole('button', { name: /开始故事/ }).click()
  await expect.poll(() => create.hits).toBe(1)

  // The switch is remembered, so local development keeps working after a reload.
  expect(await page.evaluate((key) => localStorage.getItem(key), AUTHORING_KEY)).toBe('1')
  // enteredWorld / surface are written with a 300ms debounce (usePersistedState).
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('abq_enteredWorld')))
    .toBe('true')
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.story-scene-bill, .story-panel, .chat-panel').first()).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.locator('.cold-open-showcase')).toHaveCount(0)
})

test('author: ?authoring=0 closes Story again for that browser', async ({ page }) => {
  // Author switch already stored, then explicitly closed via the URL.
  await seedStorageOnce(page, 'zh', { [AUTHORING_KEY]: '1' })
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.showcase-card--story')).toHaveAttribute('data-story-open', 'true', {
    timeout: 15_000,
  })

  await page.goto(`${BASE_URL}/?authoring=0`, { waitUntil: 'domcontentloaded' })

  const storyCard = page.locator('.showcase-card--story')
  await expect(storyCard).toHaveAttribute('data-story-open', 'false', { timeout: 15_000 })
  expect(await page.evaluate((key) => localStorage.getItem(key), AUTHORING_KEY)).toBeNull()
})

/* ------------------------------------------------------------------ */
/*  4. Stored Story surface: reclaimed for visitors (T10 follow-up)    */
/* ------------------------------------------------------------------ */

/**
 * Record whether the Story shell ever entered the DOM during a page load.
 * The init script runs before the app bundles, and a MutationObserver catches
 * an insertion even if it is removed again — a visible flash requires the
 * shell to exist at least once, so `false` is the no-flash evidence.
 */
async function trackStoryShellInDom(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __storyShellSeen?: boolean }
    w.__storyShellSeen = false
    const check = () => {
      if (document.querySelector('.app-shell, .story-scene-bill, .story-panel')) {
        w.__storyShellSeen = true
      }
    }
    new MutationObserver(check).observe(document, { childList: true, subtree: true })
    document.addEventListener('DOMContentLoaded', check)
  })
}

const storyShellSeenInDom = () =>
  (window as Window & { __storyShellSeen?: boolean }).__storyShellSeen === true

/** End-state assertion shared by the reclaim cases below. */
async function expectColdOpenDoor(page: Page) {
  await expect(page.locator('.cold-open-showcase')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.showcase-card--story')).toHaveAttribute('data-story-open', 'false')
  await expect(page.locator('.story-scene-bill')).toHaveCount(0)
  await expect(page.locator('.story-panel, .story-hud')).toHaveCount(0)
  await expect(page.locator('.story-setup')).toHaveCount(0)
  await expect(page.locator('.app-shell')).toHaveCount(0)
  expect(await page.evaluate(storyShellSeenInDom)).toBe(false)
}

test('visitor: a stored Story surface is reclaimed on load, never rendered', async ({
  page,
}, testInfo) => {
  const create = await trackSessionCreate(page)
  await trackStoryShellInDom(page)
  // Storage left behind by a pre-closure visitor: world entered + Story surface
  // (+ the saved run those two keys used to resume).
  await seedStorageOnce(page, 'zh', {
    abq_enteredWorld: 'true',
    abq_surface: JSON.stringify('story'),
    abq_productSurface: JSON.stringify('v3-mode-door'),
    abq_story_session_id: 't10-old-run',
  })

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })
  await expectColdOpenDoor(page)
  await page.screenshot({ path: testInfo.outputPath('visitor-door-after-reclaim.png') })

  // The stored switch is reset, not merely hidden, and nothing tried to resume.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('abq_enteredWorld')))
    .toBe('false')
  expect(create.hits).toBe(0)

  // A second reload lands on the door too (visitor stays out).
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expectColdOpenDoor(page)

  // The reset must not brick the rest of the product: Direct still opens and
  // the board is not reachable from there either.
  await page.getByRole('button', { name: /选择角色对话/ }).click()
  await expect(page.locator('.chat-panel')).toBeVisible()
  await expect(page.locator('.story-panel, .story-hud, .story-scene-bill')).toHaveCount(0)
})

test('visitor: the surface left by the author flow is reclaimed once ?authoring=0', async ({
  page,
}, testInfo) => {
  await installMockEventSource(page)
  const create = await trackSessionCreate(page)
  await page.route('**/api/session/*/action', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )

  // Author enters Story and starts the opening — the real product path.
  await gotoFresh(page, 'zh', '/?authoring=1')
  await page.locator('.showcase-card--story').getByRole('button', { name: /开始故事/ }).click()
  await page.getByRole('button', { name: /看过 · 直入危机/ }).click()
  await expect(page.locator('.story-scene-bill')).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: testInfo.outputPath('author-on-story-board.png') })
  await page.getByRole('button', { name: /开始故事/ }).click()
  await expect.poll(() => create.hits).toBe(1)
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('abq_enteredWorld')))
    .toBe('true')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('abq_surface')))
    .toBe(JSON.stringify('story'))

  // Same browser, author switch closed: the reload must land on the door and
  // never mount the board (tracker resets on every document).
  await trackStoryShellInDom(page)
  await page.goto(`${BASE_URL}/?authoring=0`, { waitUntil: 'domcontentloaded' })
  await expectColdOpenDoor(page)
  await page.screenshot({ path: testInfo.outputPath('visitor-door-after-authoring-0.png') })
  expect(await page.evaluate((key) => localStorage.getItem(key), AUTHORING_KEY)).toBeNull()
})

test('author: a stored Story surface still resumes after reload', async ({ page }) => {
  await installMockEventSource(page)
  await seedStorageOnce(page, 'zh', {
    abq_enteredWorld: 'true',
    abq_surface: JSON.stringify('story'),
    abq_productSurface: JSON.stringify('v3-mode-door'),
    abq_knowledgeTrack: JSON.stringify('fan'),
    [AUTHORING_KEY]: '1',
  })

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' })

  // Author keeps the board: idle Story surface, no cold open, keys untouched.
  await expect(page.locator('.story-setup')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.cold-open-showcase')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('abq_enteredWorld')))
    .toBe('true')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('abq_surface')))
    .toBe(JSON.stringify('story'))
})
