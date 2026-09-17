import { expect, test, type Page } from '@playwright/test'
import { installCommonApi } from './commonApi'

const AUTH_E2E_ENABLED = process.env.AUTH_E2E === '1'
const FAKE_SUPABASE_ORIGIN = 'https://fake.supabase.test'
const TEST_USER_ID = 'user-auth-e2e'
const TEST_EMAIL = 'player@example.com'

function base64Url(input: unknown) {
  return Buffer.from(JSON.stringify(input)).toString('base64url')
}

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  return [
    base64Url({ alg: 'HS256', typ: 'JWT' }),
    base64Url({
      aud: 'authenticated',
      exp: now + 3600,
      sub: TEST_USER_ID,
      email: TEST_EMAIL,
      role: 'authenticated',
    }),
    'signature',
  ].join('.')
}

function sessionPayload() {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: fakeJwt(),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'refresh-token-auth-e2e',
    user: {
      id: TEST_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: TEST_EMAIL,
      email_confirmed_at: new Date().toISOString(),
      phone: '',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  }
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, prefer',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'content-type': 'application/json',
  }
}

type FakeSupabaseCapture = {
  chatSelectUrls: URL[]
  memorySelectUrls: URL[]
  chatPostBodies: unknown[]
}

async function installFakeSupabase(page: Page): Promise<FakeSupabaseCapture> {
  const capture: FakeSupabaseCapture = {
    chatSelectUrls: [],
    memorySelectUrls: [],
    chatPostBodies: [],
  }

  await page.route(`${FAKE_SUPABASE_ORIGIN}/**`, async route => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders() })
      return
    }

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      await route.fulfill({ status: 200, headers: corsHeaders(), json: sessionPayload() })
      return
    }

    if (url.pathname === '/auth/v1/user') {
      await route.fulfill({ status: 200, headers: corsHeaders(), json: sessionPayload().user })
      return
    }

    if (url.pathname === '/rest/v1/chat_messages' && request.method() === 'GET') {
      capture.chatSelectUrls.push(url)
      await route.fulfill({ status: 200, headers: corsHeaders(), json: [] })
      return
    }

    if (url.pathname === '/rest/v1/character_memory' && request.method() === 'GET') {
      capture.memorySelectUrls.push(url)
      await route.fulfill({ status: 200, headers: corsHeaders(), json: { summary: '', key_facts: [] } })
      return
    }

    if (url.pathname === '/rest/v1/chat_messages' && request.method() === 'POST') {
      capture.chatPostBodies.push(request.postDataJSON())
      await route.fulfill({ status: 201, headers: corsHeaders(), json: [] })
      return
    }

    if (url.pathname === '/rest/v1/character_memory' && request.method() === 'POST') {
      await route.fulfill({ status: 201, headers: corsHeaders(), json: [] })
      return
    }

    throw new Error(`Unhandled fake Supabase request: ${request.method()} ${request.url()}`)
  })
  return capture
}

async function seedDirectProfile(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('abq_enteredWorld', JSON.stringify(true))
    localStorage.setItem('abq_productSurface', JSON.stringify('v3-mode-door'))
    localStorage.setItem('abq_surface', JSON.stringify('direct'))
    localStorage.setItem('abq_character', JSON.stringify('walter'))
    localStorage.setItem('abq_language', JSON.stringify('zh'))
  })
}

async function signInProfile(page: Page) {
  await page.getByRole('button', { name: '档案' }).click()
  await expect(page.getByText('玩家档案')).toBeVisible()
  await page.getByPlaceholder('邮箱').fill(TEST_EMAIL)
  await page.getByPlaceholder('访问密码').fill('password-123')
  await page.getByRole('button', { name: '同步档案' }).click()
  await expect(page.getByText('已同步档案')).toBeVisible()
}

test.describe('auth profile product flow', () => {
  test.skip(!AUTH_E2E_ENABLED, 'Set AUTH_E2E=1 with fake Supabase env vars to run this contract test.')

  test('cloud writes use separate Direct and Crew keys without leaking private memory', async ({ page }) => {
    await installCommonApi(page)
    const capture = await installFakeSupabase(page)
    await seedDirectProfile(page)
    const requests: Record<string, unknown>[] = []
    await page.route('**/api/chat', route => {
      const body = route.request().postDataJSON()
      requests.push(body)
      return route.fulfill({ json: body.mode === 'crew'
        ? { debate_logs: [{ sender: 'jesse', text: '群聊回复', emotion: 'tense' }] }
        : { reply_text: '单聊回复', emotion_state: 'calm' } })
    })
    await page.goto('/')
    await signInProfile(page)
    await page.getByRole('button', { name: '收起档案' }).click()
    await page.locator('.composer textarea').fill('我叫PRIVATE_CLOUD_MARKER，别告诉其他人。')
    await page.locator('.composer button[type="submit"]').click()
    await expect(page.locator('.chat-stream')).toContainText('单聊回复')
    await page.locator('.play-mode-bar').getByRole('button', { name: '群聊', exact: true }).click()
    await page.locator('.composer textarea').fill('大家晚上好')
    await page.locator('.composer button[type="submit"]').click()
    await expect(page.locator('.chat-stream')).toContainText('群聊回复')
    expect(JSON.stringify(requests[1])).not.toContain('PRIVATE_CLOUD_MARKER')
    const rows = () => capture.chatPostBodies.flatMap(body => Array.isArray(body) ? body : [body]) as Record<string, string>[]
    await expect.poll(() => rows().some(row => row.character_id === 'chat-v2:crew:walter')).toBe(true)
    expect(rows().some(row => row.character_id === 'chat-v2:direct:walter')).toBe(true)
    expect(rows().every(row => row.user_id === TEST_USER_ID && row.message.startsWith('abqenc:v1:'))).toBe(true)
    expect(capture.memorySelectUrls.every(url => url.searchParams.get('character_id') === 'eq.chat-v2:direct:walter')).toBe(true)
  })

  test('sign-in creates identity, restores session, scopes reads, and backfills local progress', async ({ page }) => {
    await installCommonApi(page)
    const { chatSelectUrls, memorySelectUrls, chatPostBodies } = await installFakeSupabase(page)
    await seedDirectProfile(page)
    await page.goto('/')
    await signInProfile(page)

    await expect(page.getByText(TEST_EMAIL)).toBeVisible()

    await expect.poll(() => chatSelectUrls.length).toBeGreaterThan(0)
    await expect.poll(() => memorySelectUrls.length).toBeGreaterThan(0)
    await expect.poll(() => chatPostBodies.length).toBeGreaterThan(0)

    expect(chatSelectUrls[0].searchParams.get('user_id')).toBe(`eq.${TEST_USER_ID}`)
    expect(chatSelectUrls[0].searchParams.get('character_id')).toBe('eq.chat-v2:direct:walter')
    expect(memorySelectUrls[0].searchParams.get('user_id')).toBe(`eq.${TEST_USER_ID}`)
    expect(memorySelectUrls[0].searchParams.get('character_id')).toBe('eq.chat-v2:direct:walter')
    const firstChatInsert = (Array.isArray(chatPostBodies[0]) ? chatPostBodies[0][0] : chatPostBodies[0]) as Record<string, string>
    expect(firstChatInsert).toMatchObject({
      user_id: TEST_USER_ID,
      character_id: 'chat-v2:direct:walter',
      sender: 'walter',
    })
    expect(firstChatInsert.message).toContain('abqenc:v1:')
    expect(firstChatInsert.message).not.toContain('我记得你')

    await page.reload()
    await page.getByRole('button', { name: '档案' }).click()
    await expect(page.getByText('已同步档案')).toBeVisible()
    await expect(page.getByText(TEST_EMAIL)).toBeVisible()
  })

  test('a rejected model turn never leaves an orphan user message in cloud history', async ({ page }) => {
    await installCommonApi(page)
    const { chatPostBodies } = await installFakeSupabase(page)
    await seedDirectProfile(page)
    await page.route('**/api/chat', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: {
          code: 'turn_rejected',
          message: 'The character response was rejected. Please retry.',
          retryable: true,
        },
      }),
    }))

    await page.goto('/')
    await signInProfile(page)
    await expect.poll(() => chatPostBodies.length).toBeGreaterThan(0)
    await page.waitForTimeout(150)
    const writesBeforeTurn = chatPostBodies.length

    await page.getByRole('button', { name: '收起档案' }).click()
    const input = page.locator('.composer textarea')
    await input.fill('这句话不应该留在云端。')
    await page.locator('.composer button[type="submit"]').click()

    await expect(page.locator('.chat-footer .error-box')).toContainText('rejected')
    await page.waitForTimeout(200)
    expect(chatPostBodies).toHaveLength(writesBeforeTurn)
    await expect(input).toHaveValue('这句话不应该留在云端。')
  })
})
