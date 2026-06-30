import { expect, test } from '@playwright/test'

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

test.describe('auth profile product flow', () => {
  test.skip(!AUTH_E2E_ENABLED, 'Set AUTH_E2E=1 with fake Supabase env vars to run this contract test.')

  test('sign-in creates identity, restores session, scopes reads, and backfills local progress', async ({ page }) => {
    const chatSelectUrls: URL[] = []
    const memorySelectUrls: URL[] = []
    const chatPostBodies: unknown[] = []

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
        chatSelectUrls.push(url)
        await route.fulfill({ status: 200, headers: corsHeaders(), json: [] })
        return
      }

      if (url.pathname === '/rest/v1/character_memory' && request.method() === 'GET') {
        memorySelectUrls.push(url)
        await route.fulfill({ status: 200, headers: corsHeaders(), json: { summary: '', key_facts: [] } })
        return
      }

      if (url.pathname === '/rest/v1/chat_messages' && request.method() === 'POST') {
        chatPostBodies.push(request.postDataJSON())
        await route.fulfill({ status: 201, headers: corsHeaders(), json: [] })
        return
      }

      if (url.pathname === '/rest/v1/character_memory' && request.method() === 'POST') {
        await route.fulfill({ status: 201, headers: corsHeaders(), json: [] })
        return
      }

      throw new Error(`Unhandled fake Supabase request: ${request.method()} ${request.url()}`)
    })

    await page.goto('/')

    await expect(page.getByText('玩家档案')).toBeVisible()
    await page.getByPlaceholder('邮箱').fill(TEST_EMAIL)
    await page.getByPlaceholder('访问密码').fill('password-123')
    await page.getByRole('button', { name: '同步档案' }).click()

    await expect(page.getByText('已同步档案')).toBeVisible()
    await expect(page.getByText(TEST_EMAIL)).toBeVisible()

    await expect.poll(() => chatSelectUrls.length).toBeGreaterThan(0)
    await expect.poll(() => memorySelectUrls.length).toBeGreaterThan(0)
    await expect.poll(() => chatPostBodies.length).toBeGreaterThan(0)

    expect(chatSelectUrls[0].searchParams.get('user_id')).toBe(`eq.${TEST_USER_ID}`)
    expect(chatSelectUrls[0].searchParams.get('character_id')).toBe('eq.walter')
    expect(memorySelectUrls[0].searchParams.get('user_id')).toBe(`eq.${TEST_USER_ID}`)
    expect(memorySelectUrls[0].searchParams.get('character_id')).toBe('eq.walter')
    const firstChatInsert = (Array.isArray(chatPostBodies[0]) ? chatPostBodies[0][0] : chatPostBodies[0]) as Record<string, string>
    expect(firstChatInsert).toMatchObject({
      user_id: TEST_USER_ID,
      character_id: 'walter',
      sender: 'walter',
    })
    expect(firstChatInsert.message).toContain('abqenc:v1:')
    expect(firstChatInsert.message).not.toContain('我记得你')

    await page.reload()
    await expect(page.getByText('已同步档案')).toBeVisible()
    await expect(page.getByText(TEST_EMAIL)).toBeVisible()
  })
})
