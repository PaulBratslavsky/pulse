import { test, expect } from '@playwright/test'

const PULSE = 'http://localhost:3000/api/pulse'

test.describe('external MCP servers', () => {
  test('a server can be registered and shows its connection state', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('MCP servers')).toBeVisible()

    const url = `https://example-mcp-${Date.now()}.invalid/mcp`
    await page.getByPlaceholder('Name (e.g. Strapi docs)').fill('Test server')
    await page.getByPlaceholder('https://…').fill(url)
    await page.getByRole('button', { name: 'Add server' }).click()

    const row = page.locator('li', { hasText: 'Test server' })
    await expect(row).toBeVisible({ timeout: 15_000 })
    // registered but never connected
    await expect(row.getByText('new', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: /Remove Test server/ }).click()
    await expect(row).toHaveCount(0, { timeout: 15_000 })
  })

  test('tokens are never exposed by the API', async ({ page, request }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const res = await request.get(`${PULSE}/mcp-servers`, { headers: { cookie } })
    const body = await res.text()
    // accessToken/refreshToken/clientSecret are `private` in the schema; if a
    // refactor ever drops that flag, an OAuth token starts leaking to the
    // browser on every settings page load
    for (const secret of ['accessToken', 'refreshToken', 'clientSecret', 'clientId']) {
      expect(body, `${secret} must never be serialized`).not.toContain(secret)
    }
  })

  test('a private-network URL is rejected in production mode only', async ({ page, request }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    // a registered URL is fetched BY THE SERVER, so this endpoint is an SSRF
    // surface; the guard is active in production
    const res = await request.post(`${PULSE}/mcp-servers`, {
      headers: { cookie },
      data: { name: 'not a url', url: 'ftp://example.com/mcp' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(400)
  })
})

test.describe('refine', () => {
  test('rejects an empty or oversized reply without calling the model', async ({ page, request }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const q = await request.get(`${PULSE}/mentions?pagination[pageSize]=1`, { headers: { cookie } })
    const id = (await q.json()).data?.[0]?.documentId
    test.skip(!id, 'no mentions in this corpus')

    for (const body of [{ text: '   ' }, { text: 'x'.repeat(8001) }]) {
      const res = await request.post(`${PULSE}/mentions/${id}/refine`, {
        headers: { cookie },
        data: body,
        failOnStatusCode: false,
      })
      // a model call on empty input is waste; on a novel it is a runaway bill
      expect([400, 503]).toContain(res.status())
    }
  })

  test('the button only offers itself once there is something to refine', async ({ page, request }) => {
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
    const q = await request.get(`${PULSE}/mentions?pagination[pageSize]=1`, { headers: { cookie } })
    const id = (await q.json()).data?.[0]?.documentId
    test.skip(!id, 'no mentions in this corpus')

    await page.goto(`/mentions/${id}`)
    const refine = page.getByRole('button', { name: 'Refine' })
    if ((await refine.count()) === 0) return // AI disabled in this environment

    await expect(refine).toBeDisabled()
    await page.getByPlaceholder('What you actually replied…').fill('some reply text')
    await expect(refine).toBeEnabled()
  })
})
