import { test, expect, type Page } from '@playwright/test'
import { installCommonApi } from './commonApi'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'

async function seedDirect(page: Page, language: 'zh' | 'en' = 'zh') {
  await page.addInitScript((lang) => {
    try {
      if (sessionStorage.getItem('relproto-seeded')) return
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('abq_language', JSON.stringify(lang))
      sessionStorage.setItem('relproto-seeded', '1')
    } catch { /* ignore */ }
  }, language)
}

async function mockChat(page: Page) {
  await page.route('**/api/chat', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    return route.fulfill({
      json: body.mode === 'crew'
        ? { debate_logs: [{ sender: 'jesse', text: 'CREW_OK', emotion: 'tense' }] }
        : { reply_text: 'DIRECT_OK', emotion_state: 'calm' },
    })
  })
}

test('prototype pills appear only with ?relproto=1 and lock after the first message', async ({ page }) => {
  await installCommonApi(page)
  await mockChat(page)
  await seedDirect(page, 'zh')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${BASE}/?relproto=1&surface=direct`, { waitUntil: 'domcontentloaded' })

  const pills = page.locator('[data-relation-prototype="true"]')
  await expect(pills).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#chat-relation')).toHaveCount(0)
  const radios = pills.getByRole('radio')
  await expect(radios).toHaveCount(4)
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true')
  await expect(radios.nth(0)).toContainText('已选')
  await expect(pills).toContainText('家里的人')

  await radios.nth(1).click()
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true')
  await expect(radios.nth(1)).toContainText('已选')
  await expect(pills).toContainText('一起干活的搭档')

  await pills.getByRole('radiogroup').press('ArrowRight')
  await expect(radios.nth(2)).toHaveAttribute('aria-checked', 'true')

  await page.locator('.composer textarea').fill('先这样开聊')
  await page.locator('.composer button[type="submit"]').click()
  await expect(page.locator('.chat-stream')).toContainText('DIRECT_OK')
  await expect(pills.getByRole('radiogroup')).toHaveCount(0)
  await expect(pills).toContainText('已选')
  await expect(pills).toContainText('开聊以后就不能在这里改关系了')
  await expect(pills).toContainText('对话里说')
})

test('prototype does not leak a relation across characters or modes', async ({ page }) => {
  await installCommonApi(page)
  await mockChat(page)
  await seedDirect(page, 'zh')
  await page.goto(`${BASE}/?relproto=1&surface=direct`, { waitUntil: 'domcontentloaded' })

  const pills = page.locator('[data-relation-prototype="true"]')
  await expect(pills).toBeVisible({ timeout: 15_000 })
  await pills.getByRole('radio').nth(2).click()
  await expect(pills.getByRole('radio').nth(2)).toContainText('已选')

  const jesse = page.locator('.char-card').filter({ has: page.locator('.char-card__en', { hasText: 'Jesse' }) })
  await jesse.click({ force: true })
  await expect(page.locator('.chat-header h2')).toContainText('杰西')
  await expect(pills.getByRole('radio').nth(2)).not.toContainText('学生')
  await expect(pills).toContainText('你是杰西的：')

  await page.locator('.play-mode-bar').getByRole('button', { name: '群聊', exact: true }).click()
  await expect(page.locator('.chat-header')).toContainText('群聊')
  await expect(pills).toContainText('你是杰西的：')
  await expect(pills.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true')

  await page.locator('.play-mode-bar').getByRole('button', { name: '单聊', exact: true }).click()
  await jesse.click({ force: true }).catch(() => {})
  await page.locator('.char-card').filter({ has: page.locator('.char-card__en', { hasText: 'Walter' }) }).click({ force: true })
  await expect(pills.getByRole('radio').nth(2)).toHaveAttribute('aria-checked', 'true')
})

test('default path without the flag still uses the header select', async ({ page }) => {
  await installCommonApi(page)
  await seedDirect(page, 'zh')
  await page.goto(`${BASE}/?surface=direct`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.chat-panel')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-relation-prototype="true"]')).toHaveCount(0)
  await expect(page.locator('#chat-relation')).toBeVisible()
})

test('guest Story gate still holds on the prototype URL', async ({ page }) => {
  await installCommonApi(page)
  await seedDirect(page, 'zh')
  await page.goto(`${BASE}/?relproto=1`, { waitUntil: 'domcontentloaded' })
  const door = page.locator('.cold-open-showcase')
  await expect(door).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.showcase-card--story')).toHaveAttribute('data-story-open', 'false')
  const box = await page.locator('.showcase-card--story').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await expect(door.locator('.showcase-card--story [role="alert"]')).toContainText('剧情正在开发中')
  await expect(page.locator('.story-panel, .story-hud')).toHaveCount(0)
})
