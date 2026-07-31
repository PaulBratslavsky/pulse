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
