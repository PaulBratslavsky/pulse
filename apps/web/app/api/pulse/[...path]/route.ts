import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

/**
 * Thin authenticated proxy for client components (mutations, chat, search).
 * Keeps the JWT in the httpOnly cookie — the browser never sees it.
 */
const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1338'
const UPSTREAM_TIMEOUT_MS = 180_000

async function proxy(request: Request, path: string[], method: string) {
  const jar = await cookies()
  const jwt = jar.get('pulse_jwt')?.value
  if (!jwt) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Segments arrive decoded, so "%2e%2e" is already ".." here. Refuse those and
  // re-encode the rest: the JWT must only ever reach Strapi's /api routes.
  if (path.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    return NextResponse.json({ error: 'bad path' }, { status: 400 })
  }
  const url = new URL(request.url)
  const target = `${STRAPI_URL}/api/${path.map(encodeURIComponent).join('/')}${url.search}`
  const body = method === 'GET' ? undefined : await request.text()
  let res: Response
  try {
    res = await fetch(target, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: body || undefined,
      // above the longest call behind this proxy: draft-chat and the assistant
      // allow the model 120 s, plus MCP tool loading
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (err: any) {
    const timedOut = err?.name === 'TimeoutError'
    return NextResponse.json(
      { error: timedOut ? 'the CMS did not answer in time' : 'could not reach the CMS' },
      { status: timedOut ? 504 : 502 }
    )
  }
  const text = await res.text()
  // 204/304 are null-body statuses — Response throws if given even an empty string
  return new NextResponse(text || null, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  })
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return proxy(request, path, 'GET')
}
export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return proxy(request, path, 'POST')
}
export async function PUT(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return proxy(request, path, 'PUT')
}
export async function DELETE(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return proxy(request, path, 'DELETE')
}
