import type { Page } from '@playwright/test'

/**
 * Stable shell APIs used by browser contracts that do not exercise a live
 * backend. Install before navigation so Vite never proxies these background
 * requests to port 8001 and hides real browser failures in connection noise.
 */
export async function installCommonApi(page: Page): Promise<void> {
  await page.route('**/api/connections/catalog', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      platform: { minimax: true, stepfun: true },
      defaults: { providerId: 'stepfun', modelId: 'step-3.7-flash' },
    }),
  }))
  await page.route('**/api/quota**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      open: true,
      tier: 'open',
      byok: false,
      remaining: 100,
      limit: 100,
      used: 0,
      globalRemaining: 1000,
    }),
  }))
}
