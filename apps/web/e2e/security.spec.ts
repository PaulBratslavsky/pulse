import { test, expect } from '@playwright/test'

import { STRAPI_URL } from './helpers'

/**
 * Boundaries a signed-in team member must not be able to cross, and pages a
 * crafted link must not be able to turn against them.
 */

const MARK = { identifier: 'mark@example.com', password: 'PulseDemo1!' }

async function jwtFor(request: any, creds: { identifier: string; password: string }) {
  const res = await request.post(`${STRAPI_URL}/api/auth/local`, { data: creds })
  expect(res.ok(), 'demo sign-in').toBeTruthy()
  return (await res.json()).jwt as string
}

test.describe('OAuth callback page', () => {
  test('a crafted code cannot run script on the Pulse origin', async ({ page }) => {
    const payload = encodeURIComponent('</script><script>window.__pwned=1</script>')
    await page.goto(`/oauth-callback?code=${payload}&state=x`)
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined()
    await expect(page.getByText('Authorization failed')).toBeVisible()
  })

  test('a real-looking code is handed back as data', async ({ page }) => {
    await page.goto('/oauth-callback?code=abc.DEF-123_~&state=s1')
    await expect(page.getByText('Authorized')).toBeVisible()
    const data = JSON.parse((await page.locator('#oauth-payload').textContent()) ?? '{}')
    expect(data).toEqual({ type: 'mcp-oauth-callback', code: 'abc.DEF-123_~', state: 's1' })
  })
})

test.describe('shared MCP servers are managed by Pulse admins only', () => {
  test('a member can list and test, but not add or change servers', async ({ request }) => {
    const jwt = await jwtFor(request, MARK)
    const headers = { Authorization: `Bearer ${jwt}` }

    const list = await request.get(`${STRAPI_URL}/api/mcp-servers`, { headers })
    expect(list.status()).toBe(200)
    expect((await list.json()).meta?.canManage).toBe(false)

    const add = await request.post(`${STRAPI_URL}/api/mcp-servers`, {
      headers,
      data: { name: 'Sneaky', url: `https://sneaky-${Date.now()}.invalid/mcp`, authType: 'none' },
    })
    expect(add.status()).toBe(403)

    for (const [method, path] of [
      ['post', '/api/mcp-servers/x/connect'],
      ['put', '/api/mcp-servers/x/token'],
      ['put', '/api/mcp-servers/x/purpose'],
      ['post', '/api/mcp-servers/x/toggle'],
      ['delete', '/api/mcp-servers/x'],
    ] as const) {
      const res = await (request as any)[method](`${STRAPI_URL}${path}`, { headers, data: {} })
      expect(res.status(), `${method} ${path}`).toBe(403)
    }
  })

  test('the demo admin can manage them', async ({ request }) => {
    const jwt = await jwtFor(request, { identifier: 'dana@example.com', password: 'PulseDemo1!' })
    const list = await request.get(`${STRAPI_URL}/api/mcp-servers`, { headers: { Authorization: `Bearer ${jwt}` } })
    expect((await list.json()).meta?.canManage).toBe(true)
  })

  test('OAuth finish with no flow in progress is refused', async ({ request }) => {
    const jwt = await jwtFor(request, { identifier: 'dana@example.com', password: 'PulseDemo1!' })
    const res = await request.post(`${STRAPI_URL}/api/mcp-servers/nope/finish-auth`, {
      headers: { Authorization: `Bearer ${jwt}` },
      data: { code: 'c', state: 'forged' },
    })
    expect(res.status()).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/no pending authorization/)
  })
})

test.describe('the /api/pulse proxy', () => {
  test('cannot be walked out of /api', async ({ page }) => {
    // signed in (storage state): the path check runs after the session check
    for (const path of ['%2e%2e/admin', '..%2Fadmin', '.']) {
      const res = await page.request.get(`/api/pulse/${path}`)
      expect([400, 404], path).toContain(res.status())
    }
    const ok = await page.request.get('/api/pulse/mcp-servers')
    expect(ok.status()).toBe(200)
  })
})
