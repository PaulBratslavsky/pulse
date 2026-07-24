import { cookies } from 'next/headers'

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1337'

/** Server-side fetch to Strapi forwarding the session JWT (httpOnly cookie). */
export async function strapiFetch<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const jar = await cookies()
  const jwt = jar.get('pulse_jwt')?.value
  const res = await fetch(`${STRAPI_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })
  if (res.status === 401 || res.status === 403) {
    const err: any = new Error('unauthorized')
    err.status = res.status
    throw err
  }
  if (!res.ok) throw new Error(`strapi ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

export const qs = (params: Record<string, string | number | undefined>) =>
  '?' +
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
