import { test, expect, type Page } from '@playwright/test'
import { installCommonApi } from './commonApi'

async function setup(page: Page, extra: Record<string, unknown> = {}) {
  await installCommonApi(page)
  await page.addInitScript((values) => {
    if (sessionStorage.getItem('mode-boundary-seeded')) return
    localStorage.clear()
    for (const [key, value] of Object.entries({
      enteredWorld: true, productSurface: 'v3-mode-door', surface: 'direct',
      character: 'walter', language: 'en', ...values,
    })) localStorage.setItem(`abq_${key}`, JSON.stringify(value))
    sessionStorage.setItem('mode-boundary-seeded', '1')
  }, extra)
}

async function send(page: Page, text: string) {
  await page.locator('.composer textarea').fill(text)
  await page.locator('.composer button[type="submit"]').click()
}

test('Direct and Crew keep separate transcripts and request context', async ({ page }, testInfo) => {
  await setup(page)
  const requests: Record<string, unknown>[] = []
  await page.route('**/api/chat', route => {
    const body = route.request().postDataJSON()
    requests.push(body)
    return route.fulfill({ json: body.mode === 'crew'
      ? { debate_logs: [{ sender: 'jesse', text: 'CREW_REPLY_ONLY', emotion: 'tense' }] }
      : { reply_text: 'DIRECT_REPLY_ONLY', emotion_state: 'calm' } })
  })
  await page.goto('/')
  await send(page, "My name is Alex. Keep DIRECT_SECRET_MARKER between us.")
  await expect(page.locator('.chat-stream')).toContainText('DIRECT_REPLY_ONLY')
  await page.locator('.play-mode-bar').getByRole('button', { name: 'Crew', exact: true }).click()
  await expect(page.locator('.chat-stream')).not.toContainText('DIRECT_SECRET_MARKER')
  await send(page, 'CREW_MESSAGE_ONLY')
  await expect(page.locator('.chat-stream')).toContainText('CREW_REPLY_ONLY')
  expect(JSON.stringify(requests[1])).not.toContain('DIRECT_SECRET_MARKER')
  expect(requests[1].durableMemory ?? '').toBe('')
  await page.locator('.play-mode-bar').getByRole('button', { name: 'Direct', exact: true }).click()
  await expect(page.locator('.chat-stream')).toContainText('DIRECT_REPLY_ONLY')
  await expect(page.locator('.chat-stream')).not.toContainText('CREW_MESSAGE_ONLY')
  await page.reload()
  await expect(page.locator('.chat-stream')).toContainText('DIRECT_REPLY_ONLY')
  await expect(page.locator('.chat-stream')).not.toContainText('CREW_REPLY_ONLY')
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('direct-isolated.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.composer textarea')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('direct-mobile.png') })
})

test('unclassified legacy history stays readable but never enters new model context', async ({ page }) => {
  await setup(page, { messages: { walter: [
    { id: 'old1', sender: 'user', text: 'LEGACY_PRIVATE_MARKER' },
    { id: 'old2', sender: 'jesse', text: 'LEGACY_GROUP_MARKER' },
  ] }, memory: { walter: { summary: 'LEGACY_PRIVATE_MARKER', keyFacts: [
    { category: 'secret', fact: 'user: LEGACY_PRIVATE_MARKER' },
  ] } } })
  let request: Record<string, unknown> | null = null
  await page.route('**/api/chat', route => {
    request = route.request().postDataJSON()
    return route.fulfill({ json: { reply_text: 'NEW_REPLY', emotion_state: 'calm' } })
  })
  await page.goto('/')
  await expect(page.locator('.chat-stream')).not.toContainText('LEGACY_PRIVATE_MARKER')
  await page.locator('.chat-legacy-archive summary').click()
  await expect(page.locator('.chat-legacy-archive')).toContainText('LEGACY_GROUP_MARKER')
  await send(page, 'Hello again')
  await expect(page.locator('.chat-stream')).toContainText('NEW_REPLY')
  expect(JSON.stringify(request)).not.toContain('LEGACY_')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('abq_messages')!).walter.length)).toBe(2)
})

test('late Direct failure cannot replace a Crew draft or error state', async ({ page }) => {
  await setup(page)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/chat', async route => {
    await held
    await route.fulfill({ status: 503, json: { detail: 'DIRECT_ONLY_ERROR' } }).catch(() => {})
  })
  await page.goto('/')
  await send(page, 'DIRECT_DRAFT')
  await page.locator('.play-mode-bar').getByRole('button', { name: 'Crew', exact: true }).click()
  await page.locator('.composer textarea').fill('CREW_DRAFT')
  release()
  await expect(page.locator('.composer textarea')).toHaveValue('CREW_DRAFT')
  await expect(page.locator('.composer button[type="submit"]')).toBeEnabled()
  await expect(page.locator('.chat-footer')).not.toContainText('DIRECT_ONLY_ERROR')
  await page.locator('.play-mode-bar').getByRole('button', { name: 'Direct', exact: true }).click()
  await expect(page.locator('.composer textarea')).toHaveValue('DIRECT_DRAFT')
})

test('Story recovery never changes the independent chat partner', async ({ page }) => {
  await setup(page, { character: 'saul' })
  let stateReads = 0
  await page.addInitScript(() => {
    localStorage.setItem('abq_story_session_id', 'separate-story')
    localStorage.setItem('abq_story_session_key', 'test-key')
  })
  await page.route('**/api/session/separate-story/messages*', route => route.fulfill({ json: [] }))
  await page.route('**/api/session/separate-story/state', route => {
    stateReads += 1
    return route.fulfill({ json: {
    runtime_version: 1, world_revision: 2, player_actor_id: 'jesse',
    world: { player_id: 'jesse' }, status: 'waiting', pending_command_id: null,
    command_id: 'saved', events: [{ type: 'beat_ready', data: { beat_id: 'beat_2' } }],
    } })
  })
  await page.goto('/')
  await expect(page.locator('.chat-header h2')).toContainText('Saul')
  await page.waitForTimeout(200)
  expect(stateReads).toBe(0)
  await page.locator('.play-mode-bar').getByRole('button', { name: 'Story', exact: true }).click()
  await expect(page.locator('.story-hud')).toContainText('Jesse')
  await page.locator('.play-mode-bar').getByRole('button', { name: 'Direct', exact: true }).click()
  await expect(page.locator('.chat-header h2')).toContainText('Saul')
})
