# Strapi data loading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the throwing `strapiFetch` with the four-layer pattern in `docs/strapi-data-loading.md` — typed envelope, one transport with timeouts, a `loaders` object owning every Strapi URL, and errors returned as values.

**Architecture:** `types/index.ts` gains the response envelope; `lib/data-api.ts` is the only place that calls `fetch`; `lib/loaders.ts` is the only place a Strapi URL is written; pages consume loaders and narrow on `success`.

**Tech Stack:** Next.js 16.2.11, React 19.2.4, TypeScript 5, Playwright 1.62, `qs`. No new dependencies.

**Spec:** `docs/strapi-data-loading.md`

## Global Constraints

- **Behaviour is frozen.** Same pages, same redirects, same fallbacks. `npx playwright test` (with `PW_BASE_URL`) must match the pre-change baseline: **196 passed, 2 failed, 9 skipped**, where the 2 `leads.spec.ts` failures are pre-existing and reproduce on master.
- **Auth is per request.** The JWT lives in the httpOnly `pulse_jwt` cookie and must be read inside the request via `await cookies()`. A module-level token would pin one user's session across renders — see §3 of the spec.
- **Never swallow `redirect()`.** Next throws a sentinel to unwind the render. Any `catch` must rethrow what it does not handle.
- **No `any`** in files this plan creates or touches.
- Every existing comment moves with the code it explains.
- Run all commands from `apps/web/`.

## The two call-site shapes

Everything in the app is one of these. Both must survive:

```ts
// REQUIRED data — page cannot render without it
try { data = await strapiFetch('/api/x') }
catch (err: any) { if (err.status === 401 || err.status === 403) redirect('/sign-in'); throw err }
// becomes
const res = await loaders.getX()
if (isAuthError(res)) redirect('/sign-in')
if (!res.success) throw new Error(res.error?.message ?? 'failed to load x')

// OPTIONAL data — page degrades
const muted = await strapiFetch('/api/muted-authors').catch(() => ({ data: [] }))
// becomes
const muted = (await loaders.getMutedAuthors()).data ?? []
```

---

### Task 1: The envelope

**Files:** Modify `apps/web/types/index.ts`

**Interfaces:**
- Produces: `TStrapiResponse<T>` (now `{ data?, meta?, error?, success, status }`), `TStrapiError` (now an object, not an Error subclass), `THTTPMethod`, `TApiOptions<P>`, `TRequestOptions`.

- [ ] **Step 1: Replace the envelope types**

```ts
/**
 * Every response from the transport, success or failure. `success` is the
 * discriminant — narrow on it and TypeScript hands you `data` without a `!`.
 */
export type TStrapiResponse<T> = {
  data?: T
  meta?: {
    pagination?: TPagination
    /**
     * Whether the server ACTUALLY grouped. It falls back to a flat list when
     * the filtered set is too large to group honestly, so the queue's label
     * has to read this rather than assume it got what it asked for.
     */
    grouped?: boolean
  }
  error?: TStrapiError
  success: boolean
  status: number
}

/** Strapi's own error shape, plus the ones we synthesise for timeout/network. */
export type TStrapiError = {
  status: number
  name: string
  message: string
  details?: unknown
}

export type THTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type TRequestOptions = { timeoutMs?: number; authToken?: string }

export type TApiOptions<P = Record<string, unknown>> = TRequestOptions & {
  method: THTTPMethod
  payload?: P
}
```

- [ ] **Step 2: Typecheck to find the fallout**

Run: `npx tsc --noEmit`
Expected: errors in `lib/queue/fetch.ts` and `app/page.tsx` only — `data` is now optional. Leave them; Task 4 fixes the queue.

- [ ] **Step 3: Commit**

```bash
git add apps/web/types/index.ts
git commit -m "refactor(types): the response envelope carries success, status and error"
```

---

### Task 2: The transport

**Files:** Create `apps/web/lib/data-api.ts`

**Interfaces:**
- Consumes: `TApiOptions`, `TRequestOptions`, `TStrapiResponse` from `@/types`.
- Produces: `apiRequest<T, P>(url, options): Promise<TStrapiResponse<T>>` and `api.get/post/put/patch/delete`.

- [ ] **Step 1: Write it**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/data-api.ts
git commit -m "feat(data): one transport, with a deadline and errors as values"
```

---

### Task 3: The loaders

**Files:** Create `apps/web/lib/loaders.ts`; modify `apps/web/lib/strapi.ts` (keep `strapiFetch` until Task 5 removes it, move `fetchAllTopics` onto `api`).

**Interfaces:**
- Produces: `authToken()`, `strapiUrl(path, query?)`, `isAuthError(res)`, and a `loaders` object with one function per query — named after what the page needs, not after the endpoint.

- [ ] **Step 1: Write the shared pieces**

```ts
import { cookies } from 'next/headers'
import qs from 'qs'

import { api } from '@/lib/data-api'
import type { TStrapiResponse } from '@/types'

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1338'

/**
 * The session token, read per request.
 *
 * NOT a module constant: Pulse authenticates per user from an httpOnly cookie,
 * and a module-level value is evaluated once per process — it would either be
 * empty or pin one user's token across every render the server handles.
 */
async function authToken(): Promise<string | undefined> {
  return (await cookies()).get('pulse_jwt')?.value
}

/** encodeValuesOnly keeps brackets readable in a log or a network tab. */
function strapiUrl(path: string, query?: Record<string, unknown>): string {
  const url = new URL(path, STRAPI_URL)
  if (query) url.search = qs.stringify(query, { encodeValuesOnly: true })
  return url.href
}

/** A 401/403 means the session is gone, not that the query was wrong. */
export function isAuthError(res: TStrapiResponse<unknown>): boolean {
  return res.status === 401 || res.status === 403
}
```

- [ ] **Step 2: Add one loader per existing call site**

One function per thing a page needs, each returning `Promise<TStrapiResponse<T>>`, each calling `api.get(strapiUrl(...), { authToken: await authToken() })`. Derive the list from `grep -rn "strapiFetch" app components` — 37 call sites across 13 files. Name them for the page's need (`getSettingsPanels`, `getMentionDetail`) rather than the endpoint.

Export as one object so a page imports one symbol:

```ts
export const loaders = { getQueue, getMentionDetail, getTrends, /* … */ }
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add apps/web/lib/loaders.ts apps/web/lib/strapi.ts
git commit -m "feat(data): loaders own every Strapi URL, and the token is per request"
```

---

### Task 4: Migrate the queue, then every other page

Queue first because it has the most coverage — if the envelope change is wrong, `queue-and-detail.spec.ts` and `responsive.spec.ts` say so immediately.

**Files:** `lib/queue/fetch.ts`, `app/page.tsx`, then the 12 remaining files.

- [ ] **Step 1: Queue** — `fetch.ts` calls `api.get` via a loader, keeps the grouped→flat retry (now branching on `res.success` rather than a throw), keeps both `redirect('/sign-in')` paths.
- [ ] **Step 2: Run the queue tests** — `npx playwright test --project=app -g "queue"` plus `--project=unit`.
- [ ] **Step 3: Migrate the remaining 12 files**, one commit each, using the two shapes above. Typecheck after each.
- [ ] **Step 4: Commit per file** so a regression bisects to one page.

---

### Task 5: Remove `strapiFetch` and verify

- [ ] **Step 1:** Delete `strapiFetch` from `lib/strapi.ts`. If anything still imports it, `tsc` names the file.
- [ ] **Step 2:** `npx tsc --noEmit`, `npm run build`, `npx eslint`.
- [ ] **Step 3:** Full suite with the server on a known port:

```bash
PW_BASE_URL=http://localhost:3002 npx playwright test
```

Expected: **196 passed, 2 failed, 9 skipped** — the same two pre-existing `leads.spec.ts` failures, and nothing else.

- [ ] **Step 4:** Update `docs/strapi-data-loading.md` §6 to say the migration is done.

## Done when

- No file outside `lib/data-api.ts` calls `fetch`; no file outside `lib/loaders.ts` writes a Strapi URL.
- `strapiFetch` is gone.
- Every request has a timeout.
- The suite matches the baseline exactly.
