import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1337'

export async function POST(request: Request) {
  const { identifier, password } = await request.json()
  const res = await fetch(`${STRAPI_URL}/api/auth/local`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  })
  const data = await res.json()
  if (!res.ok || !data.jwt) {
    return NextResponse.json(
      { error: data?.error?.message ?? 'sign-in failed' },
      { status: res.status || 401 }
    )
  }
  const jar = await cookies()
  jar.set('pulse_jwt', data.jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return NextResponse.json({ user: { id: data.user?.id, username: data.user?.username } })
}
