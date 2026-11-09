import { test, expect, type APIRequestContext } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { STRAPI_URL } from './helpers'

/**
 * The brain plugin's tools on the real /mcp server, through an admin token
 * that holds only the brain's permissions: the way the marketing brain
 * connects. Catches a tool that stops registering, a permission that stops
 * gating, or a build stamp that goes missing, before a deploy does.
 *
 * Needs a database with no admin yet (CI's fresh one): the test registers the
 * first admin with generated credentials and mints the token through the
 * admin API. On a database that already has an admin it skips.
 */

const BRAIN_TOOLS = [
  'brain-guide',
  'brain-health',
  'brain-youtube-channels',
  'brain-youtube-videos',
  'brain-video-results',
  'brain-save-report',
  'brain-decisions',
  'brain-update-decision',
]
const actionFor = (tool: string) => `plugin::brain.tools.${tool.replace(/^brain-/, '')}`

const pluginVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../cms/src/plugins/brain/package.json'), 'utf8')
).version

/** Minimal MCP client over streamable HTTP: JSON or a single SSE message back. */
function mcpClient(request: APIRequestContext, token: string) {
  let sessionId: string | undefined
  let id = 0
  const post = async (body: object) => {
    const res = await request.post(`${STRAPI_URL}/mcp`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      data: body,
    })
    sessionId = res.headers()['mcp-session-id'] ?? sessionId
    const text = await res.text()
    const data = text.split('\n').find((l) => l.startsWith('data:'))
    return text.trim() ? JSON.parse(data ? data.slice(5) : text) : {}
  }
  const rpc = async (method: string, params: object = {}) => post({ jsonrpc: '2.0', id: ++id, method, params })
  return {
    async connect() {
      await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } })
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    },
    rpc,
    async call(name: string, args: object = {}) {
      const res = await rpc('tools/call', { name, arguments: args })
      return { error: res.error, isError: res.result?.isError, result: res.result?.structuredContent?.result }
    },
  }
}

test.describe('the brain on the MCP server', () => {
  let adminJwt = ''
  let tokenId: number | undefined
  let accessKey = ''

  test.beforeAll(async ({ request }) => {
    const suffix = Math.random().toString(36).slice(2, 10)
    const register = await request.post(`${STRAPI_URL}/admin/register-admin`, {
      data: { firstname: 'E2E', lastname: 'Admin', email: `e2e-admin-${suffix}@example.com`, password: `E2e-${suffix}-Pass1` },
    })
    if (!register.ok()) return // an admin already exists: not a fresh database
    adminJwt = (await register.json()).data.token

    const created = await request.post(`${STRAPI_URL}/admin/admin-tokens`, {
      headers: { authorization: `Bearer ${adminJwt}` },
      data: {
        name: `e2e-brain-${suffix}`,
        description: 'e2e: brain tools only',
        lifespan: null,
        adminPermissions: BRAIN_TOOLS.map((t) => ({ action: actionFor(t), subject: null, properties: {}, conditions: [] })),
      },
    })
    expect(created.ok(), await created.text()).toBeTruthy()
    const body = (await created.json()).data
    tokenId = body.id
    accessKey = body.accessKey
  })

  test.afterAll(async ({ request }) => {
    if (tokenId) await request.delete(`${STRAPI_URL}/admin/admin-tokens/${tokenId}`, { headers: { authorization: `Bearer ${adminJwt}` } })
  })

  test('a brain-only token sees the brain tools and nothing of Pulse', async ({ request }) => {
    test.skip(!accessKey, 'needs a database with no admin yet (CI)')
    const mcp = mcpClient(request, accessKey)
    await mcp.connect()
    const names: string[] = ((await mcp.rpc('tools/list')).result?.tools ?? []).map((t: any) => t.name)
    for (const tool of BRAIN_TOOLS) expect(names, tool).toContain(tool)
    expect(names.filter((n) => n.startsWith('pulse-'))).toEqual([])

    const refused = await mcp.call('pulse-queue', { limit: 1 })
    expect(refused.error?.message ?? '').toMatch(/disabled|not found/)
  })

  test('brain-guide says which build is running', async ({ request }) => {
    test.skip(!accessKey, 'needs a database with no admin yet (CI)')
    const mcp = mcpClient(request, accessKey)
    await mcp.connect()
    const { result, error } = await mcp.call('brain-guide')
    expect(error).toBeUndefined()
    expect(result.guide).toContain('# The marketing brain')
    expect(result.build.version).toBe(pluginVersion)
    expect(result.build.builtAt).toBeTruthy()
    expect(result.build.bootedAt).toBeTruthy()
  })

  test('brain-health and brain-youtube-channels answer from stored data', async ({ request }) => {
    test.skip(!accessKey, 'needs a database with no admin yet (CI)')
    const mcp = mcpClient(request, accessKey)
    await mcp.connect()

    const health = await mcp.call('brain-health', { days: 7 })
    expect(health.error).toBeUndefined()
    expect(['ok', 'attention', 'off']).toContain(health.result.status)
    expect(health.result.channels.length).toBeGreaterThan(0)
    expect(health.result.sync).toHaveProperty('apiKeyConfigured')
    expect(JSON.stringify(health.result)).not.toMatch(/AIza/) // a YouTube key's prefix: never in a result

    const channels = await mcp.call('brain-youtube-channels', { days: 7 })
    expect(channels.error).toBeUndefined()
    expect(Array.isArray(channels.result.channels)).toBeTruthy()
  })
})
