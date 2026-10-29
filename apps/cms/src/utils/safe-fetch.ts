import dns from 'node:dns'
import net from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'

/**
 * fetch for URLs a team member typed in (MCP servers), which the SERVER then
 * requests — an SSRF primitive unless every request is checked.
 *
 * Checking the URL once at registration is not enough: DNS can change after,
 * a name can resolve inward (`127.0.0.1.nip.io`), OAuth discovery and token
 * calls go to hosts the MCP server names, and redirects go anywhere. So the
 * check runs on the address each connection actually uses (a DNS lookup hook
 * on the agent — no gap between check and connect), on IP literals before the
 * request, and again on every redirect hop.
 *
 * Kept free of Strapi imports so the unit tests can load it directly.
 */

export class BlockedAddressError extends Error {
  readonly expose = true
  constructor(what: string) {
    super(`refused: ${what} is a private or internal address`)
  }
}

const v4ToInt = (ip: string) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local: cloud instance metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
]

const inV4 = (ip: string) => {
  const n = v4ToInt(ip)
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (n & mask) === (v4ToInt(base) & mask)
  })
}

/** Eight 16-bit groups, or null if it is not IPv6. Handles `::` and a dotted tail. */
function hextets(ip: string): number[] | null {
  let s = ip.replace(/^\[|\]$/g, '').split('%')[0]
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const n = v4ToInt(dotted[1])
    s = s.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const [head, tail] = s.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined && tail ? tail.split(':') : []
  const fill = s.includes('::') ? 8 - h.length - t.length : 0
  const all = [...h, ...Array(fill).fill('0'), ...t]
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null
  return all.map((g) => parseInt(g, 16))
}

/** True for loopback, private, link-local, CGNAT, multicast — v4, v6, and v4 hidden inside v6. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '')
  if (net.isIPv4(bare)) return inV4(bare)
  const g = hextets(bare)
  if (!g) return true // not an address we understand: refuse rather than guess
  const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`
  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible, also covers :: and ::1), 64:ff9b::/96 (NAT64)
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return inV4(embeddedV4())
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return inV4(embeddedV4())
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

type LookupFn = typeof dns.lookup

/** A dns.lookup that fails when ANY address it returns is blocked. */
export function guardedLookup(resolve: LookupFn = dns.lookup): LookupFn {
  return ((hostname: string, options: any, callback: any) => {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    resolve(hostname, options, (err: any, address: any, family?: number) => {
      if (err) return callback(err)
      const list: string[] = Array.isArray(address) ? address.map((a: any) => a.address) : [address]
      const bad = list.find(isBlockedAddress)
      if (bad) return callback(new BlockedAddressError(`${hostname} (${bad})`))
      callback(null, address, family)
    })
  }) as LookupFn
}

/** Refuse a URL whose host is an IP literal in a blocked range (these skip DNS). */
export function checkUrl(raw: string | URL): URL {
  const u = new URL(String(raw))
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new BlockedAddressError(`${u.protocol} URL`)
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) throw new BlockedAddressError(host)
  if (net.isIP(host) && isBlockedAddress(host)) throw new BlockedAddressError(host)
  return u
}

const MAX_REDIRECTS = 5

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * Build the guarded fetch. `enforce: false` (local dev, e2e) is plain fetch, so
 * the localhost stub servers keep working; production always enforces.
 */
export function makeSafeFetch(opts: { enforce: boolean; lookup?: LookupFn }): FetchLike {
  if (!opts.enforce) return (input, init) => fetch(input as any, init)
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(opts.lookup) } })

  return async (input, init = {}) => {
    let url = checkUrl(typeof input === 'string' || input instanceof URL ? input : input.url)
    let method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    let body = init.body
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
    for (let hop = 0; ; hop++) {
      const res = (await undiciFetch(url, { ...(init as any), method, body, headers, redirect: 'manual', dispatcher })) as unknown as Response
      if (res.status < 300 || res.status >= 400 || !res.headers.get('location')) return res
      if (hop >= MAX_REDIRECTS) throw new Error('too many redirects')
      await res.body?.cancel().catch(() => {})
      const next = checkUrl(new URL(res.headers.get('location')!, url))
      // as fetch does: credentials never follow a redirect to another origin
      if (next.origin !== url.origin) for (const h of ['authorization', 'cookie', 'proxy-authorization']) headers.delete(h)
      url = next
      // fetch's own rule: 303, and 301/302 after a POST, continue as a GET with no body
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET'
        body = undefined
      }
    }
  }
}

/** The process-wide instance: enforced in production only. */
export const safeFetch: FetchLike = makeSafeFetch({ enforce: process.env.NODE_ENV === 'production' })
