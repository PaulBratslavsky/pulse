'use client'

/**
 * THE client-side API helper — every client component talks to the backend
 * through this (via the authenticated /api/pulse proxy; the JWT stays in the
 * httpOnly cookie). One error policy: parse Strapi's error envelope, fall
 * back to status text, always throw PulseApiError with the status attached.
 */
export class PulseApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function pulseFetch<T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`/api/pulse/${path.replace(/^\//, '')}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => null)
    throw new PulseApiError(res.status, payload?.error?.message ?? `request failed (${res.status})`)
  }
  return res.json().catch(() => ({}) as T)
}
