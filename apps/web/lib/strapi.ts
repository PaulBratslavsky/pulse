import { cookies } from 'next/headers'

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1338'

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

/**
 * Every topic, not the first hundred.
 *
 * Both callers asked for `pageSize=100` and treated the answer as the whole
 * vocabulary. `maxLimit: 100` in the CMS config makes that the ceiling, so the
 * moment the 101st topic was created the picker silently stopped seeing the
 * tail of the alphabet — and a picker that cannot find "Webflow" offers to
 * CREATE it, forking the vocabulary it exists to protect. Silent, and worse the
 * longer it runs.
 *
 * Pages to exhaustion, with a stop so a bad pageCount cannot spin forever.
 */
export async function fetchAllTopics(): Promise<{ documentId: string; name: string }[]> {
  const out: any[] = []
  for (let page = 1; page <= 20; page++) {
    const res: any = await strapiFetch(
      `/api/topics?pagination[pageSize]=100&pagination[page]=${page}&sort=name:asc`
    )
    out.push(...(res?.data ?? []))
    if (page >= (res?.meta?.pagination?.pageCount ?? 1)) break
  }
  return out
}
