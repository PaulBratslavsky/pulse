import { NextResponse } from 'next/server'

/**
 * Webhook relay for Octolens → Strapi.
 *
 * Why this exists: Octolens' SSRF check misclassifies Strapi Cloud's
 * Cloudflare-fronted IPs (172.66.x.x — public, but a naive "172.*" test reads
 * them as private) and refuses the direct URL. Vercel's IPs pass their check,
 * so Octolens posts here and we forward server-side.
 *
 * No secret is stored on Vercel: the incoming ?secret= is moved into the
 * x-pulse-secret header and Strapi remains the single validator (bad secret
 * still 401s end-to-end).
 */
const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1337'

export async function POST(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret') ?? ''
  const body = await request.text()

  const res = await fetch(`${STRAPI_URL}/api/ingest/octolens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pulse-secret': secret },
    body: body || '{}',
  })
  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  })
}
