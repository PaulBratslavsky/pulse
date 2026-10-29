import { test, expect } from '@playwright/test'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { isReadOnlyTool } from '../../cms/src/utils/mcp-read-only'
import { isBlockedAddress, guardedLookup, checkUrl, makeSafeFetch } from '../../cms/src/utils/safe-fetch'
import { publicError } from '../../cms/src/utils/public-error'

/**
 * The guards around MCP servers a team member registers. No browser and no
 * stack: these are pure functions, and a table says what they allow better
 * than any amount of clicking.
 */

test.describe('which MCP tools the drafter may call', () => {
  const KEPT = ['list_blog-post', 'get_blog-post', 'searchDocs', 'ask_ai', 'pulse-get-mention', 'kapa_search_sources', 'query']
  const DROPPED = [
    'create_blog-post',
    'createIssue',
    'send_msg',
    'post_tweet',
    'pulse-update-mention',
    'pulse-mute-topic',
    'run_job',
    'discard_blog-post_draft',
    'do_thing', // no verb we know: left out rather than guessed
  ]
  for (const name of KEPT) test(`keeps ${name}`, () => expect(isReadOnlyTool({ name })).toBe(true))
  for (const name of DROPPED) test(`drops ${name}`, () => expect(isReadOnlyTool({ name })).toBe(false))

  test('the server can vouch for a tool, or rule it out', () => {
    expect(isReadOnlyTool({ name: 'do_thing', annotations: { readOnlyHint: true } })).toBe(true)
    expect(isReadOnlyTool({ name: 'get_thing', annotations: { readOnlyHint: false } })).toBe(false)
    expect(isReadOnlyTool({ name: 'get_thing', annotations: { destructiveHint: true } })).toBe(false)
  })
})

test.describe('addresses a registered MCP URL may reach', () => {
  const BLOCKED = [
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '[::1]',
    '::',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe', // the same, as the URL parser writes it
    '64:ff9b::a9fe:a9fe',
    'fd00::1',
    'fe80::1',
  ]
  const ALLOWED = ['8.8.8.8', '104.18.1.1', '2606:4700::1111', '::ffff:8.8.8.8']
  for (const a of BLOCKED) test(`blocks ${a}`, () => expect(isBlockedAddress(a)).toBe(true))
  for (const a of ALLOWED) test(`allows ${a}`, () => expect(isBlockedAddress(a)).toBe(false))

  test('IP literals and localhost are refused before any request', () => {
    for (const u of ['http://[::1]/mcp', 'http://[::ffff:a9fe:a9fe]/', 'http://127.0.0.1:1337/', 'http://localhost/', 'ftp://example.com/']) {
      expect(() => checkUrl(u), u).toThrow(/refused/)
    }
    expect(checkUrl('https://strapi-docs.mcp.kapa.ai/').hostname).toBe('strapi-docs.mcp.kapa.ai')
  })

  test('a name that resolves to an internal address is refused at lookup', async () => {
    const fakeDns: any = (_h: string, _o: any, cb: any) => cb(null, [{ address: '127.0.0.1', family: 4 }], 4)
    const lookup: any = guardedLookup(fakeDns)
    const err = await new Promise<any>((resolve) => lookup('127.0.0.1.nip.io', { all: true }, (e: any) => resolve(e)))
    expect(String(err?.message)).toMatch(/refused: 127\.0\.0\.1\.nip\.io \(127\.0\.0\.1\)/)

    const publicDns: any = (_h: string, _o: any, cb: any) => cb(null, '93.184.215.14', 4)
    const ok: any = guardedLookup(publicDns)
    const res = await new Promise<any>((resolve) => ok('example.com', {}, (e: any, a: any) => resolve(e ?? a)))
    expect(res).toBe('93.184.215.14')
  })

  test('the enforcing fetch will not connect to a local server, even by name', async () => {
    const server = http.createServer((_req, res) => res.end('SECRET')).listen(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    const port = (server.address() as AddressInfo).port
    try {
      // a name, so the request reaches DNS: the stub resolver says "127.0.0.1"
      const fakeDns: any = (_h: string, _o: any, cb: any) => cb(null, [{ address: '127.0.0.1', family: 4 }], 4)
      const guarded = makeSafeFetch({ enforce: true, lookup: fakeDns })
      const err = await guarded(`http://internal.test:${port}/`).then(
        () => null,
        (e) => e
      )
      expect(err).not.toBeNull()
      // what Settings would show: the reason, and nothing the server sent
      const shown = publicError(err)
      expect(shown).toMatch(/refused/)
      expect(shown).not.toContain('SECRET')
    } finally {
      server.close()
    }
  })
})

test.describe('what a failing MCP server may tell the person', () => {
  test('a remote body never comes back, only a category', () => {
    const sdkStyle = new Error('Error POSTing to endpoint (HTTP 500): {"internal":"SECRET metadata token"}')
    expect(publicError(sdkStyle)).not.toContain('SECRET')
    expect(publicError(new Error('HTTP 401 Unauthorized: SECRET'))).toBe('the server rejected the credentials')
    expect(publicError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toBe(
      'could not reach the server'
    )
  })

  test("Pulse's own messages are shown as written", () => {
    expect(publicError(Object.assign(new Error('the server exposes no tools'), { expose: true }))).toBe(
      'the server exposes no tools'
    )
  })
})
