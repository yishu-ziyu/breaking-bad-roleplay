import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function gotoFresh(page: Page) {
  await page.goto(BASE_URL)
  await page.waitForLoadState('networkidle')
}

/**
 * Seed localStorage before the app mounts. addInitScript runs before any page
 * script, so React's initial usePersistedState reads the seeded values.
 */
async function seedStorage(page: Page, values: Record<string, unknown>) {
  await page.addInitScript((data) => {
    for (const [key, value] of Object.entries(data)) {
      window.localStorage.setItem(key, JSON.stringify(value))
    }
  }, values)
  await page.goto(BASE_URL)
  await page.waitForLoadState('networkidle')
}

function chatState(
  charId: string,
  messages: unknown[],
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    abq_character: charId,
    abq_messages: { [charId]: messages },
    ...extras,
  }
}

async function seedMessages(page: Page, charId: string, messages: unknown[]) {
  await seedStorage(page, chatState(charId, messages))
}

async function seedCharacter(page: Page, charId: string) {
  await seedStorage(page, { abq_character: charId })
}

async function selectCharacter(page: Page, name: string) {
  const button = page.locator('.char-card', { hasText: name })
  await button.click()
  await expect(button).toHaveClass(/selected/)
}

async function sendChatMessage(page: Page, text: string) {
  const input = page.locator('.composer input')
  await input.fill(text)
  await page.locator('.composer button[type="submit"]').click()
}

async function mockChatDirect(
  page: Page,
  reply: {
    reply_text: string
    emotion_state?: string
    gif_search_query?: string
  },
) {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        thinking: '',
        tool_executed: null,
        tool_log: null,
        ...reply,
      }),
    })
  })
}

async function mockChatCrew(
  page: Page,
  debateLogs: Array<{
    sender: string
    text: string
    emotion?: string
    gifQuery?: string
  }>,
) {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        participants: debateLogs.map((l) => l.sender),
        scene_goal: 'Mock crew debate',
        tension_note: 'Tense',
        debate_logs: debateLogs,
      }),
    })
  })
}

async function mockVoiceFileExists(page: Page) {
  await page.route('**/voice/walter.mp3', async (route) => {
    const method = route.request().method()
    if (method === 'HEAD') {
      await route.fulfill({ status: 200, headers: { 'content-type': 'audio/mpeg' } })
      return
    }
    // Tiny silent MP3 (valid headers, no audio frames needed for loadmetadata in most browsers)
    const mp3 = Buffer.from(
      'SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgBUWFZYAAAAEQAAA21pbm9yX3ZlcnNpb24AMABUWFZYAAAAHAAAA2NvbXBhdGlibGVfYnJhbmRzAGlzb21tcDQyAP/7UAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM//uQZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWgAAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'base64',
    )
    await route.fulfill({ status: 200, body: mp3, headers: { 'content-type': 'audio/mpeg' } })
  })
}

async function mockVoiceFileMissing(page: Page) {
  await page.route('**/voice/**', async (route) => {
    await route.fulfill({ status: 404, body: 'Not found' })
  })
}

/* ------------------------------------------------------------------ */
/*  AC-1: Fresh incognito → "Try without login" visible                */
/* ------------------------------------------------------------------ */

test('AC-1: fresh session shows "Try without login" CTA', async ({ page }) => {
  await gotoFresh(page)
  const cta = page.getByRole('button', { name: /Try without login|无需登录，先试试/ })
  await expect(cta).toBeVisible()
})

/* ------------------------------------------------------------------ */
/*  AC-2: Anonymous chat → refresh → history restored                  */
/* ------------------------------------------------------------------ */

test('AC-2: anonymous chat history survives refresh', async ({ page }) => {
  const charId = 'walter'
  const userText = 'Can we talk?'
  const replyText = 'We always talk. The question is whether you listen.'

  await seedMessages(page, charId, [
    { id: 'opener-walter', sender: charId, text: 'Choose your words carefully.', emotion: 'opening pressure', gifQuery: null, gifUrl: null },
    { id: 'msg-user-1', sender: 'user', text: userText },
    { id: 'msg-reply-1', sender: charId, text: replyText, emotion: 'tense', gifQuery: null, gifUrl: null },
  ])

  await gotoFresh(page)
  const storedAfterLoad = await page.evaluate(() => localStorage.getItem('abq_messages'))
  const charAfterLoad = await page.evaluate(() => localStorage.getItem('abq_character'))
  console.log('AC-2 DEBUG stored:', storedAfterLoad)
  console.log('AC-2 DEBUG character:', charAfterLoad)
  const html = await page.content()
  console.log('AC-2 DEBUG html has userText:', html.includes(userText))
  await expect(page.locator('.msg--user p', { hasText: userText })).toBeVisible()
  await expect(page.locator('.msg--char p', { hasText: replyText })).toBeVisible()

  await page.reload()
  await page.waitForLoadState('networkidle')

  await expect(page.locator('.msg--user p', { hasText: userText })).toBeVisible()
  await expect(page.locator('.msg--char p', { hasText: replyText })).toBeVisible()
})

/* ------------------------------------------------------------------ */
/*  AC-3: Walter/Gus reply → GIF card visible                          */
/* ------------------------------------------------------------------ */

test('AC-3: Walter direct reply renders a GIF card', async ({ page }) => {
  await seedCharacter(page, 'walter')
  await mockChatDirect(page, {
    reply_text: 'Chemistry is the study of change.',
    emotion_state: 'chemistry',
    gif_search_query: 'chemistry',
  })

  await gotoFresh(page)
  await sendChatMessage(page, 'Tell me about chemistry.')

  const gifCard = page.locator('.msg--char .gif-card img').last()
  await expect(gifCard).toBeVisible()
  const src = await gifCard.getAttribute('src')
  expect(src).toMatch(/^https:\/\//)
})

/* ------------------------------------------------------------------ */
/*  AC-4: Skyler direct reply → GIF card visible after pool expansion  */
/* ------------------------------------------------------------------ */

test('AC-4: Skyler direct reply renders a GIF card', async ({ page }) => {
  await seedCharacter(page, 'skyler')
  await mockChatDirect(page, {
    reply_text: 'I am going to ask this once plainly.',
    emotion_state: 'family',
    gif_search_query: 'family',
  })

  await gotoFresh(page)
  await selectCharacter(page, 'Skyler')
  await sendChatMessage(page, 'What do you want?')

  await expect(page.locator('.msg--char p', { hasText: 'I am going to ask this once plainly.' })).toBeVisible()
  const gifCard = page.locator('.msg--char .gif-card img').last()
  await expect(gifCard).toBeVisible()
  const src = await gifCard.getAttribute('src')
  expect(src).toMatch(/^https:\/\//)
})

/* ------------------------------------------------------------------ */
/*  AC-5: Send "lab" or "cook" → background cross-fades to lab-rv      */
/* ------------------------------------------------------------------ */

test('AC-5: lab/cook keywords switch scene background to lab-rv', async ({ page }) => {
  await seedStorage(page, chatState('walter', [
    { id: 'opener-walter', sender: 'walter', text: 'Choose your words carefully.', emotion: 'opening pressure', gifQuery: null, gifUrl: null },
    { id: 'msg-user-1', sender: 'user', text: 'We need to cook a new batch in the lab right now.' },
  ]))

  await gotoFresh(page)
  const currentLayer = page.locator('.scene-layer--current')
  await expect(currentLayer).toHaveCSS('background-image', /lab-rv\.svg/)
})

/* ------------------------------------------------------------------ */
/*  AC-6: If voice file exists → play button works                     */
/* ------------------------------------------------------------------ */

test('AC-6: voice sample play button is enabled when audio file exists', async ({ page }) => {
  await seedStorage(page, chatState('walter', [
    { id: 'opener-walter', sender: 'walter', text: 'Choose your words carefully.', emotion: 'opening pressure', gifQuery: null, gifUrl: null },
  ]))
  await mockVoiceFileExists(page)

  await gotoFresh(page)
  const playButton = page.locator('.msg--char .voice-player').first()
  await expect(playButton).toBeVisible()
  await expect(playButton).toBeEnabled()
  await expect(playButton).toContainText(/Voice|▶/)
})

/* ------------------------------------------------------------------ */
/*  AC-7: speechSynthesis unavailable → disabled placeholder, no error */
/*  (Was: missing voice file → disabled. VoicePlayer now uses          */
/*   speechSynthesis instead of HEAD-probing audio files.)             */
/* ------------------------------------------------------------------ */

test('AC-7: VoicePlayer renders disabled placeholder when speechSynthesis unavailable', async ({ page }) => {
  // Remove speechSynthesis so VoicePlayer falls back to disabled state
  await page.addInitScript(() => {
    delete (window as any).speechSynthesis
  })
  await seedStorage(page, chatState('walter', [
    { id: 'opener-walter', sender: 'walter', text: 'Choose your words carefully.', emotion: 'opening pressure', gifQuery: null, gifUrl: null },
  ]))

  // Ensure no console errors (e.g. runtime exception from missing audio)
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await gotoFresh(page)
  const player = page.locator('.msg--char .voice-player').first()
  await expect(player).toBeVisible()
  await expect(player).toHaveClass(/voice-player--disabled/)

  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})

/* ------------------------------------------------------------------ */
/*  AC-8: Crew mode → each debate log has its own GIF                  */
/* ------------------------------------------------------------------ */

test('AC-8: crew debate renders a GIF card for each debate log', async ({ page }) => {
  await seedStorage(page, chatState('walter', [], { abq_mode: 'crew' }))
  await mockChatCrew(page, [
    { sender: 'walter', text: 'We need to be careful.', emotion: 'tense', gifQuery: 'tense' },
    { sender: 'gus', text: 'Everything is under control.', emotion: 'business', gifQuery: 'business' },
  ])

  await gotoFresh(page)
  await expect(page.locator('header.chat-header p')).toContainText(/Crew Debate|多人剧情辩论|宏观辩论/)
  await sendChatMessage(page, 'What is the plan?')

  const gifCards = page.locator('.msg--char .gif-card img')
  await expect(gifCards).toHaveCount(2)
  for (let i = 0; i < 2; i++) {
    const src = await gifCards.nth(i).getAttribute('src')
    expect(src).toMatch(/^https:\/\//)
  }
})

/* AC-9 (story mode SSE) has been superseded by tests/e2e/sse-story.spec.ts
   which mocks EventSource directly and covers outline / beat_paused /
   continue / redirect / complete / error. The old mockStory helper mocked a
   non-existent /api/story JSON endpoint that was decoupled from the real
   SSE implementation in useStoryStream.ts. */
