import type { TApiOptions, TRequestOptions, TStrapiResponse } from '@/types'

/** 8s: long enough for a cold Strapi, short enough that a hung CMS is not a hung page. */
const DEFAULT_TIMEOUT_MS = 8000

/**
 * fetch with a deadline.
 *
 * Without this a hung CMS holds a server render open until the platform kills
 * it, and the user watches a spinner instead of reading an error they can act
 * on. The timer is cleared in `finally` so it cannot leak on any path.
 */
async function apiWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function failure<T>(status: number, name: string, message: string): TStrapiResponse<T> {
  return { error: { status, name, message }, success: false, status }
}

/**
 * The only place in the app that calls fetch.
 *
 * Returns failures as values rather than throwing: a caller that must handle a
 * 401 should be told so by the type, not by a stack trace at runtime.
 */
export async function apiRequest<T = unknown, P = Record<string, unknown>>(
  url: string,
  options: TApiOptions<P>
): Promise<TStrapiResponse<T>> {
  const { method, payload, timeoutMs = DEFAULT_TIMEOUT_MS, authToken } = options

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authToken) headers.Authorization = `Bearer ${authToken}`

  try {
    const response = await apiWithTimeout(
      url,
      {
        method,
        headers,
        // GET and DELETE carry no body — serialising {} into a GET makes some
        // proxies reject the request outright.
        body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(payload ?? {}),
        cache: 'no-store',
      },
      timeoutMs
    )

    // A 204 has no body; parsing it unconditionally throws.
    if (method === 'DELETE') {
      return response.ok
        ? { data: true as T, success: true, status: response.status }
        : failure<T>(response.status, 'Error', 'Failed to delete resource')
    }

    const body = await response.json().catch(() => null)

    if (!response.ok) {
      // Strapi's own error shape is more useful than anything we could invent.
      if (body?.error) return { error: body.error, success: false, status: response.status }
      return failure<T>(
        response.status,
        'Error',
        response.statusText || `Request failed with ${response.status}`
      )
    }

    // Unwrap Strapi's envelope once, here, so no call site writes res.data.data.
    return {
      data: (body?.data ?? body) as T,
      meta: body?.meta,
      success: true,
      status: response.status,
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return failure<T>(408, 'TimeoutError', 'The request timed out. Please try again.')
    }
    return failure<T>(
      500,
      'NetworkError',
      error instanceof Error ? error.message : 'Something went wrong'
    )
  }
}

/**
 * Usage:
 *   const res = await api.get<TMention[]>(url, { authToken })
 *   if (!res.success) …
 */
export const api = {
  get: <T>(url: string, o: TRequestOptions = {}) => apiRequest<T>(url, { method: 'GET', ...o }),
  post: <T, P = Record<string, unknown>>(url: string, payload: P, o: TRequestOptions = {}) =>
    apiRequest<T, P>(url, { method: 'POST', payload, ...o }),
  put: <T, P = Record<string, unknown>>(url: string, payload: P, o: TRequestOptions = {}) =>
    apiRequest<T, P>(url, { method: 'PUT', payload, ...o }),
  patch: <T, P = Record<string, unknown>>(url: string, payload: P, o: TRequestOptions = {}) =>
    apiRequest<T, P>(url, { method: 'PATCH', payload, ...o }),
  delete: <T>(url: string, o: TRequestOptions = {}) =>
    apiRequest<T>(url, { method: 'DELETE', ...o }),
}
