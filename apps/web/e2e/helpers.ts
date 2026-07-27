import { Page, APIRequestContext, expect } from '@playwright/test'

export const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337'
export const WEBHOOK_SECRET = process.env.OCTOLENS_WEBHOOK_SECRET ?? 'dev-secret-123'

export const DANA = { identifier: 'dana@example.com', password: 'PulseDemo1!' }

export async function signIn(page: Page, creds = DANA) {
  await page.goto('/sign-in')
  await page.getByPlaceholder('Email or username').fill(creds.identifier)
  await page.getByPlaceholder('Password').fill(creds.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  // more robust than waitForURL: the queue heading only renders authenticated.
  // 30s: dev-mode first-compile of a route after a fresh install can exceed 15s.
  await expect(page.getByRole('heading', { name: 'Queue' })).toBeVisible({ timeout: 30_000 })
}

/** Inject a fresh mention through the real ingest webhook; returns its documentId. */
export async function injectMention(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
) {
  const externalId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const res = await request.post(`${STRAPI_URL}/api/ingest/octolens`, {
    headers: { 'x-pulse-secret': WEBHOOK_SECRET },
    data: {
      id: externalId,
      text: `E2E test mention ${externalId} — the docs are confusing here`,
      platform: 'x',
      author: { handle: 'e2e_bot' },
      url: `https://example.com/${externalId}`,
      ...overrides,
    },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.documentId).toBeTruthy()
  return { documentId: body.documentId as string, externalId }
}
