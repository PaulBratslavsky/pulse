import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

/**
 * Thin authenticated proxy for client components (mutations, chat, search).
 * Keeps the JWT in the httpOnly cookie — the browser never sees it.
 */
const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1337'

async function proxy(request: Request, path: string[], method: string) {
  const jar = await cookies()
  const jwt = jar.get('pulse_jwt')?.value
  if (!jwt) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const target = `${STRAPI_URL}/api/${path.join('/')}${url.search}`
  const body = method === 'GET' ? undefined : await request.text()
  const res = await fetch(target, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: body || undefined,
  })
  const text = await res.text()
  // 204/304 are null-body statuses — Response throws if given even an empty string
  return new NextResponse(text || null, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
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
