# Queue page refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `app/page.tsx` from cognitive complexity 37 to under 15 by separating its four jobs, type it against a new `types/` folder, and extract every nested ternary — with no change to what renders.

**Architecture:** Pure logic moves to `lib/queue/` (query building, filter URLs, current search, fetch-with-fallback). JSX moves to `components/queue/` in five pieces. `types/index.ts` replaces `lib/types.ts` with `T`-prefixed names plus API-envelope and route-param types. `page.tsx` becomes composition only.

**Tech Stack:** Next.js 16.2.11, React 19.2.4, TypeScript 5, Tailwind 4, Playwright 1.62. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-08-11-queue-page-refactor-design.md`

## Global Constraints

- **Behaviour is frozen.** Every rendered element, class name, URL, title attribute and filter must be identical. `e2e/queue-and-detail.spec.ts` and `e2e/responsive.spec.ts` must pass **with no edits** — editing them would mean behaviour changed.
- **Comments move with the code they explain.** Do not summarise, shorten, or drop them. The notes on the grouping fallback, on `'key' in over`, and on the awaiting-reply filter being Reddit-only are the highest-value content in this file.
- **`qs` is the query builder.** Strapi parses query strings *with* `qs`, and
  their own guidance is to write populate and filters explicitly rather than
  hand-flatten or reach for a Populate Deep plugin. `qs` + `@types/qs` are
  declared in `apps/web/package.json`; both already resolve as transitive deps,
  so no install is needed to work, but run `npm install` after merging to write
  the lockfile.
- **Browser-facing URLs do not change at all.** `filter-url.ts` and
  `current-search.ts` build what the address bar shows and stay on
  `URLSearchParams` / the existing helper — byte-identical. Only the *outbound*
  Strapi request is rebuilt with `qs`, where `encodeValuesOnly: true` leaves
  brackets readable. Semantically identical request, different encoding of the
  same keys.
- **No other new npm dependencies.**
- **No `any`** in any file this plan creates or touches, except where an existing untouched signature already requires it.
- `T` prefix on every exported type in `types/index.ts`.
- This repo's Next.js has breaking changes vs. training data (see `apps/web/AGENTS.md`).
- Run all commands from `apps/web/`.

---

### Task 1: The types folder

**Files:**
- Create: `apps/web/types/index.ts`
- Create: `apps/web/lib/mentions.ts`
- Delete: `apps/web/lib/types.ts`
- Modify: `apps/web/components/ui/index.tsx:3` (`UserRef` → `TUserRef`)
- Modify: `apps/web/app/page.tsx:8` (import `commentCount` from `@/lib/mentions`)

**Interfaces:**
- Consumes: nothing.
- Produces: from `@/types` — `TStrapiResponse<T>`, `TPagination`, `TStrapiError`, `TQueueSearchParams`, `TQueueFilterOverrides`, `TMention`, `TUserRef`, `TTopicRef`, `TChannelRef`, `TResponseRecord`, `TCommentEntry`, `TActivityEntry`, `TMentionStatus`, `TSentimentLabel`, `TOutcomeResult`, `TCommentKind`, `TLane`. From `@/lib/mentions` — `commentCount(m: Pick<TMention, 'comments'>): number`.

- [ ] **Step 1: Create `apps/web/types/index.ts`**

```ts
/**
 * Wire types for the Pulse API.
 *
 * Shaped by the backend's controllers rather than by the database: user
 * relations are always trimmed to id/documentId/username before they leave
 * Strapi, so that is what the frontend can rely on.
 */

// ── API envelope ────────────────────────────────────────────────────────────

/** What `strapiFetch` resolves to. `meta` is absent on single-entity reads. */
export type TStrapiResponse<T> = {
  data: T
  meta?: {
    pagination?: TPagination
    /**
     * Whether the server ACTUALLY grouped. It falls back to a flat list when
     * the filtered set is too large to group honestly, so the queue's label
     * has to read this rather than assume it got what it asked for.
     */
    grouped?: boolean
  }
}

export type TPagination = {
  page: number
  pageSize?: number
  pageCount: number
  total: number
}

/** An error from `strapiFetch` carrying the HTTP status it failed with. */
export type TStrapiError = Error & { status?: number }

// ── Route params ────────────────────────────────────────────────────────────

/**
 * The queue's URL, as Next hands it over — every value a string, because that
 * is what a query string holds.
 */
export type TQueueSearchParams = {
  status?: string
  sentiment?: string
  topic?: string
  page?: string
  draft?: string
  quality?: string
  topics?: string
  sort?: string
  q?: string
  lane?: string
  awaiting?: string
  every?: string
}

/**
 * Overrides passed to `filterUrl`. Separate from TQueueSearchParams on
 * purpose: `page` is a number here and a string in the URL, and one shared
 * shape would have to lie about one of them.
 */
export type TQueueFilterOverrides = Omit<TQueueSearchParams, 'page'> & { page?: number }

// ── Unions ──────────────────────────────────────────────────────────────────

export type TOutcomeResult = 'resolved' | 'positive-turn' | 'no-reaction' | 'escalated'
export type TMentionStatus = 'unanswered' | 'claimed' | 'answered' | 'resolved' | 'acknowledged'
export type TSentimentLabel = 'positive' | 'neutral' | 'negative' | 'na'
export type TCommentKind = 'comment' | 'note' | 'feedback'
/** respond/lead are reply work; monitor is discourse kept for trends only. */
export type TLane = 'respond' | 'lead' | 'monitor'

// ── Domain ──────────────────────────────────────────────────────────────────

export type TUserRef = { id: number; documentId: string; username: string }
export type TTopicRef = { documentId?: string; name: string; slug: string; kind?: string }
export type TChannelRef = { name: string; key?: string }

export type TResponseRecord = {
  documentId: string
  finalText: string
  draftText?: string | null
  notes?: string | null
  internal?: boolean
  respondedAt?: string
  respondedBy?: TUserRef | null
  outcome?: { result: TOutcomeResult; notes?: string | null; recordedAt?: string } | null
}

export type TCommentEntry = {
  documentId: string
  kind: TCommentKind
  body: string
  links?: string[] | null
  createdAt: string
  editedAt?: string | null
  author?: TUserRef | null
}

export type TActivityEntry = {
  documentId: string
  action: string
  detail?: Record<string, unknown> | null
  at?: string
  actor?: TUserRef | null
}

export type TMention = {
  documentId: string
  externalId: string
  content: string
  authorHandle?: string | null
  url?: string | null
  postedAt?: string | null
  receivedAt?: string | null
  status: TMentionStatus
  acknowledgeReason?: string | null
  sentimentLabel?: TSentimentLabel | null
  sentimentScore?: number | null
  humanCorrected?: boolean
  modelVersion?: string | null
  promptVersion?: string | null
  draftText?: string | null
  draftedVia?: string | null
  quality?: string | null
  lane?: TLane | null
  laneReason?: string | null
  awaitsReply?: boolean
  /** how many messages the row stands for when the queue is grouped */
  threadSize?: number
  channel?: TChannelRef | null
  topics?: TTopicRef[]
  owner?: TUserRef | null
  assignee?: TUserRef | null
  responses?: TResponseRecord[]
  activities?: TActivityEntry[]
  /** detail API: array; list API: relation count */
  comments?: TCommentEntry[] | { count: number }
}
```

- [ ] **Step 2: Create `apps/web/lib/mentions.ts`**

```ts
import type { TMention } from '@/types'

/** list-vs-detail helper: the queue gets a count, the detail page an array */
export const commentCount = (m: Pick<TMention, 'comments'>): number =>
  Array.isArray(m.comments) ? m.comments.length : (m.comments?.count ?? 0)
```

- [ ] **Step 3: Update the two importers and delete the old file**

`apps/web/components/ui/index.tsx` line 3:

```ts
import type { TUserRef } from '@/types'
```

and its one use, in `UserChip`'s props: `user: TUserRef | null | undefined`.

`apps/web/app/page.tsx` line 8:

```ts
import { commentCount } from '@/lib/mentions'
```

Then:

```bash
rm apps/web/lib/types.ts
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `lib/types` is still referenced anywhere, the compiler names the file.

- [ ] **Step 5: Commit**

```bash
git add apps/web/types apps/web/lib/mentions.ts apps/web/components/ui/index.tsx apps/web/app/page.tsx
git rm apps/web/lib/types.ts
git commit -m "refactor(types): a types folder, T-prefixed, with the API envelope named"
```

---

### Task 2: The pure query and URL builders

**Files:**
- Create: `apps/web/lib/queue/query.ts`
- Create: `apps/web/lib/queue/filter-url.ts`
- Create: `apps/web/lib/queue/current-search.ts`
- Create: `apps/web/e2e/queue-query.spec.ts`
- Modify: `apps/web/playwright.config.ts` (widen the `unit` project's `testMatch`)

**Interfaces:**
- Consumes: `TQueueSearchParams`, `TQueueFilterOverrides` from `@/types`; `qs` from `@/lib/strapi`.
- Produces:
  - `buildQueueQuery(params: TQueueSearchParams, page: number, grouped: boolean): Record<string, string | number | undefined>`
  - `makeFilterUrl(params: TQueueSearchParams): (over: TQueueFilterOverrides) => string`
  - `buildCurrentSearch(params: TQueueSearchParams, page: number): string`

- [ ] **Step 1: Widen the unit project**

In `apps/web/playwright.config.ts`, change the `unit` project's `testMatch` so it picks up both pure-function specs:

```ts
    { name: 'unit', testMatch: /(plain-text|queue-query)\.spec\.ts/ },
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/e2e/queue-query.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import qs from 'qs'

import { buildQueueQuery } from '../lib/queue/query'
import { makeFilterUrl } from '../lib/queue/filter-url'
import { buildCurrentSearch } from '../lib/queue/current-search'

test('query: the default queue is open work in the reply lanes, oldest first', () => {
  const q = buildQueueQuery({}, 1, true)
  expect(q.filters.status).toEqual({ $in: ['unanswered', 'claimed'] })
  expect(q.filters.lane).toEqual({ $in: ['respond', 'lead'] })
  expect(q.filters.quality).toEqual({ $ne: 'spam' })
  expect(q.sort).toBe('postedAt:asc')
  expect(q.group).toBe('thread')
  expect(q.pagination).toEqual({ page: 1, pageSize: 25 })
})

test('query: an explicit status replaces the two-status default', () => {
  expect(buildQueueQuery({ status: 'answered' }, 1, true).filters.status).toEqual({
    $in: ['answered'],
  })
})

test('query: lane=all drops the lane filter entirely', () => {
  expect(buildQueueQuery({ lane: 'all' }, 1, true).filters.lane).toBeUndefined()
})

test('query: a named lane filters to exactly that lane', () => {
  expect(buildQueueQuery({ lane: 'monitor' }, 1, true).filters.lane).toEqual({ $eq: 'monitor' })
})

test('query: an explicit quality replaces the spam exclusion', () => {
  expect(buildQueueQuery({ quality: 'suspected-spam' }, 1, true).filters.quality).toEqual({
    $eq: 'suspected-spam',
  })
})

test('query: ungrouped omits the group param rather than sending false', () => {
  expect('group' in buildQueueQuery({}, 1, false)).toBe(false)
})

test('query: newest sorts descending', () => {
  expect(buildQueueQuery({ sort: 'newest' }, 1, true).sort).toBe('postedAt:desc')
})

test('query: the optional filters each map to their Strapi operator', () => {
  const q = buildQueueQuery(
    { sentiment: 'negative', topic: 'auth', topics: 'none', q: 'strapi', draft: '1', awaiting: '1' },
    3,
    true
  )
  expect(q.filters.sentimentLabel).toEqual({ $eq: 'negative' })
  expect(q.filters.topics).toEqual({ slug: { $eq: 'auth' }, documentId: { $null: true } })
  expect(q.filters.content).toEqual({ $containsi: 'strapi' })
  expect(q.filters.draftText).toEqual({ $notNull: true })
  expect(q.filters.awaitsReply).toEqual({ $eq: true })
  expect(q.pagination.page).toBe(3)
})

/**
 * The nested object is only worth anything if it serialises to the keys Strapi
 * expects. One test at the boundary rather than string-matching every case.
 */
test('query: serialises to the bracket keys Strapi parses', () => {
  const search = qs.stringify(buildQueueQuery({ lane: 'monitor' }, 2, true), {
    encodeValuesOnly: true,
  })
  expect(search).toContain('filters[status][$in][0]=unanswered')
  expect(search).toContain('filters[status][$in][1]=claimed')
  expect(search).toContain('filters[lane][$eq]=monitor')
  expect(search).toContain('filters[quality][$ne]=spam')
  expect(search).toContain('pagination[page]=2')
  expect(search).toContain('pagination[pageSize]=25')
  expect(search).toContain('group=thread')
})

test('filterUrl: no filters is the bare root', () => {
  expect(makeFilterUrl({})({})).toBe('/')
})

test('filterUrl: an omitted key inherits the current value', () => {
  const url = makeFilterUrl({ status: 'claimed', lane: 'lead' })({ sentiment: 'negative' })
  expect(url).toContain('status=claimed')
  expect(url).toContain('lane=lead')
  expect(url).toContain('sentiment=negative')
})

/**
 * The behaviour the "all" chip and the topic ✕ depend on. `?? params.key`
 * would silently ignore an explicit undefined and the filter would never clear.
 */
test('filterUrl: an explicit undefined CLEARS, it does not inherit', () => {
  const url = makeFilterUrl({ status: 'claimed', topic: 'auth' })({ topic: undefined })
  expect(url).toContain('status=claimed')
  expect(url).not.toContain('topic=')
})

test('filterUrl: page 1 is left out of the URL', () => {
  expect(makeFilterUrl({})({ page: 1 })).toBe('/')
  expect(makeFilterUrl({})({ page: 2 })).toBe('/?page=2')
})

test('currentSearch: carries the live filters and omits page 1', () => {
  const s = buildCurrentSearch({ status: 'claimed', q: 'strapi' }, 1)
  expect(s).toContain('status=claimed')
  expect(s).toContain('q=strapi')
  expect(s).not.toContain('page=')
  expect(buildCurrentSearch({}, 4)).toContain('page=4')
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx playwright test --project=unit`
Expected: FAIL — `Cannot find module '../lib/queue/query'`.

- [ ] **Step 4: Write `apps/web/lib/queue/query.ts`**

```ts
import type { TQueueSearchParams } from '@/types'

/**
 * Lanes: the queue is REPLY work. Competitor/industry discourse is kept in full
 * and still feeds trends and themes — it just doesn't belong in a list a human
 * works through. ~2/3 of ingest is that.
 *
 * Extracted from a nested ternary in the page body: three outcomes reading as
 * one expression is where this file's complexity came from. Returning undefined
 * for "all" lets qs drop the key rather than send an empty filter.
 */
function laneFilter(lane: string | undefined) {
  if (lane === 'all') return undefined
  if (lane) return { $eq: lane }
  return { $in: ['respond', 'lead'] }
}

/**
 * The queue's URL, translated into a Strapi query object.
 *
 * Nested rather than hand-flattened: `{ lane: { $in: ['respond', 'lead'] } }`
 * is what `filters[lane][$in][0]=respond&filters[lane][$in][1]=lead` means, and
 * maintaining a serialiser's output as source is how index typos get in. `qs`
 * does the flattening at the fetch boundary — it is the library Strapi itself
 * parses with.
 *
 * `grouped` is a parameter rather than read from `params` because the caller
 * retries with it off — see lib/queue/fetch.ts.
 */
export function buildQueueQuery(params: TQueueSearchParams, page: number, grouped: boolean) {
  return {
    filters: {
      // one-element $in rather than $eq when a status is named, matching what
      // this query has always sent
      status: { $in: params.status ? [params.status] : ['unanswered', 'claimed'] },
      ...(params.sentiment ? { sentimentLabel: { $eq: params.sentiment } } : {}),
      ...(params.topic || params.topics === 'none'
        ? {
            topics: {
              ...(params.topic ? { slug: { $eq: params.topic } } : {}),
              // unlabeled backlog — the set a bulk topic pass exists for
              ...(params.topics === 'none' ? { documentId: { $null: true } } : {}),
            },
          }
        : {}),
      // "is this actually about us?" — most of the queue arrives via
      // competitor keyword monitoring and never names Strapi
      ...(params.q ? { content: { $containsi: params.q } } : {}),
      ...(params.draft ? { draftText: { $notNull: true } } : {}),
      // Someone answered us and nobody answered them. Derived on write
      // (utils/thread-state) rather than computed here, because "the last
      // message in this thread that is not ours" is not expressible as a
      // filter over a single row.
      ...(params.awaiting ? { awaitsReply: { $eq: true } } : {}),
      // spam is stored but never queued; suspected-spam stays visible with a badge
      quality: params.quality ? { $eq: params.quality } : { $ne: 'spam' },
      ...(laneFilter(params.lane) ? { lane: laneFilter(params.lane) } : {}),
    },
    sort: params.sort === 'newest' ? 'postedAt:desc' : 'postedAt:asc',
    // One row per conversation by default. Octolens ingests every comment in a
    // thread as its own mention, so a single Reddit exchange arrives as N rows
    // that look like N separate jobs — and the one actually waiting on us is
    // indistinguishable from the ones already handled.
    ...(grouped ? { group: 'thread' } : {}),
    pagination: { page, pageSize: 25 },
  }
}
```

- [ ] **Step 5: Write `apps/web/lib/queue/filter-url.ts`**

```ts
import type { TQueueFilterOverrides, TQueueSearchParams } from '@/types'

/**
 * Every filter that survives a link, in the order the original set them — so a
 * URL built from the same state is byte-identical to the pre-refactor one.
 *
 * `awaiting` is deliberately absent, matching the original exactly: it was
 * declared in the override type and then never read or written. Task 6 fixes
 * that as its own change, so this one stays a pure refactor.
 */
const FILTER_KEYS = [
  'status',
  'sentiment',
  'topic',
  'draft',
  'quality',
  'topics',
  'sort',
  'q',
  'lane',
  'every',
] as const

/**
 * Builds queue URLs relative to the filters currently in the address bar.
 *
 * `key in over` — NOT `over[key] !== undefined` — so passing an explicit
 * undefined actually CLEARS the filter. The "all" chip and the topic ✕ depend
 * on it: they pass `{ topic: undefined }` and mean it.
 */
export function makeFilterUrl(params: TQueueSearchParams) {
  return (over: TQueueFilterOverrides): string => {
    const q = new URLSearchParams()

    for (const key of FILTER_KEYS) {
      const value = key in over ? over[key] : params[key]
      if (value) q.set(key, value)
    }

    // `awaiting` is toggled by its own pill and never inherited implicitly
    const awaiting = 'awaiting' in over ? over.awaiting : params.awaiting
    if (awaiting) q.set('awaiting', awaiting)

    if (over.page && over.page > 1) q.set('page', String(over.page))

    const search = q.toString()
    return search ? `/?${search}` : '/'
  }
}
```

- [ ] **Step 6: Write `apps/web/lib/queue/current-search.ts`**

```ts
import { qs } from '@/lib/strapi'
import type { TQueueSearchParams } from '@/types'

const CARRIED = [
  'status',
  'sentiment',
  'topic',
  'topics',
  'draft',
  'awaiting',
  'quality',
  'lane',
  'sort',
  'q',
  'every',
] as const

/**
 * The query as the browser has it, so returning here restores this exact view.
 * Page 1 is left out — it is the default, and a URL that says so is noise.
 */
export function buildCurrentSearch(params: TQueueSearchParams, page: number): string {
  const carried: Record<string, string | undefined> = {}
  for (const key of CARRIED) if (params[key]) carried[key] = params[key]
  if (page > 1) carried.page = String(page)
  return qs(carried)
}
```

- [ ] **Step 7: Run to verify they pass**

Run: `npx playwright test --project=unit`
Expected: PASS — the plain-text cases plus 13 new ones.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/queue apps/web/e2e/queue-query.spec.ts apps/web/playwright.config.ts
git commit -m "refactor(queue): the query and the URLs become functions with names"
```

---

### Task 3: The fetch, with its fallback and its auth check

**Files:**
- Create: `apps/web/lib/queue/fetch.ts`

**Interfaces:**
- Consumes: `buildQueueQuery` (Task 2); `strapiFetch`, `qs` from `@/lib/strapi`; `TMention`, `TQueueSearchParams`, `TStrapiError`, `TStrapiResponse` from `@/types`.
- Produces: `fetchQueue(params: TQueueSearchParams, page: number): Promise<TStrapiResponse<TMention[]>>` and `isAuthError(err: unknown): boolean`.

- [ ] **Step 1: Write `apps/web/lib/queue/fetch.ts`**

```ts
import { redirect } from 'next/navigation'
import qs from 'qs'

import { strapiFetch } from '@/lib/strapi'
import { buildQueueQuery } from '@/lib/queue/query'
import type { TMention, TQueueSearchParams, TStrapiError, TStrapiResponse } from '@/types'

/** A 401/403 from strapiFetch means the session is gone, not that the query was wrong. */
export function isAuthError(err: unknown): boolean {
  const status = (err as TStrapiError)?.status
  return status === 401 || status === 403
}

/**
 * The queue's mentions, grouped by conversation where the server can manage it.
 *
 * `group` is a param only the newer CMS understands, and `strictParams` makes an
 * older one reject the whole request with a 400 rather than ignore it. The
 * frontend deploys in a minute and the CMS takes several, so there is always a
 * window where this queue talks to a backend that predates it — and without the
 * retry the queue is a 500 for the length of that window. Falls back to the flat
 * list, which is a worse view, not a broken page.
 */
export async function fetchQueue(
  params: TQueueSearchParams,
  page: number
): Promise<TStrapiResponse<TMention[]>> {
  // encodeValuesOnly so the brackets stay readable in a log or a network tab —
  // Strapi parses either form, and an unreadable URL costs an hour the first
  // time a filter misbehaves.
  const get = (grouped: boolean) =>
    strapiFetch<TStrapiResponse<TMention[]>>(
      '/api/mentions?' +
        qs.stringify(buildQueueQuery(params, page, grouped), { encodeValuesOnly: true })
    )

  const wantGrouped = !params.every

  try {
    return await get(wantGrouped)
  } catch (err) {
    if (isAuthError(err)) redirect('/sign-in')
    if (!wantGrouped) throw err
    // only the grouping could have caused this — retry without it
    return await get(false).catch((e: unknown) => {
      if (isAuthError(e)) redirect('/sign-in')
      throw e
    })
  }
}
```

**Note on `redirect()`:** Next's `redirect` throws a special error to unwind the
render. It is called inside a `catch`, so it must NOT be swallowed — both call
sites rethrow everything they do not handle, which preserves that. Do not wrap
either `catch` in a broader try.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/queue/fetch.ts
git commit -m "refactor(queue): name the auth check and the grouped-fetch fallback"
```

---

### Task 4: The JSX, in five pieces

**Files:**
- Create: `apps/web/components/queue/queue-header.tsx`
- Create: `apps/web/components/queue/queue-filters.tsx`
- Create: `apps/web/components/queue/queue-empty.tsx`
- Create: `apps/web/components/queue/queue-row.tsx`
- Create: `apps/web/components/queue/queue-pagination.tsx`
- Modify: `apps/web/app/page.tsx` (becomes composition only)

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces (all default-exportless named components):
  - `QueueHeader({ params, grouped, total, filterUrl })`
  - `QueueFilters({ params, filterUrl })`
  - `QueueEmpty({ awaiting })`
  - `QueueRow({ mention, filterUrl })`
  - `QueuePagination({ pagination, pageUrl })`

  where `filterUrl: (over: TQueueFilterOverrides) => string` and
  `pageUrl: (p: number) => string`.

- [ ] **Step 1: `queue-header.tsx` — with both ternaries extracted**

Move lines 172-209 of the current `page.tsx` verbatim, with the two nested
ternaries lifted out of the JSX:

```tsx
import { FilterPill } from '@/components/ui'
import SyncButton from '@/components/queue/sync-button'
import type { TQueueFilterOverrides, TQueueSearchParams } from '@/types'

export function QueueHeader({
  params,
  grouped,
  total,
  filterUrl,
}: {
  params: TQueueSearchParams
  grouped: boolean
  total: number
  filterUrl: (over: TQueueFilterOverrides) => string
}) {
  // Was a nested ternary inside the title attribute. Three different claims
  // about what the number counts, and which one is true depends on how the
  // server answered — worth a name each.
  let countTitle: string
  if (grouped) {
    countTitle = `${total} conversations — a thread of six messages is one row here`
  } else if (params.status) {
    countTitle = `${total} ${params.status} mentions`
  } else {
    countTitle = `${total} mentions still open (unanswered or claimed)`
  }

  let subject: string
  if (grouped) {
    subject = 'Conversations'
  } else if (params.status) {
    subject = `${params.status} mentions`
  } else {
    subject = 'Unanswered and claimed mentions'
  }

  const order = params.sort === 'newest' ? ', newest first.' : ', oldest first.'

  return (
    <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
      <div>
        {/* count is the whole filtered set, not this page — "how much is
            left" is the number you want at a glance, and it rides along in
            the pagination meta for free */}
        <h1 className="flex items-baseline gap-2.5 text-2xl font-semibold">
          Queue
          <span
            data-testid="queue-count"
            className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-sm font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            title={countTitle}
          >
            {total}
          </span>
        </h1>
        <p className="text-sm text-zinc-500">
          {subject}
          {order}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1 text-sm" role="group" aria-label="Sort order">
          <FilterPill
            href={filterUrl({ sort: undefined, page: 0 })}
            active={params.sort !== 'newest'}
            title="Oldest first — SLA order: what has waited longest"
          >
            oldest
          </FilterPill>
          <FilterPill
            href={filterUrl({ sort: 'newest', page: 0 })}
            active={params.sort === 'newest'}
            title="Newest first — catching up on what just arrived"
          >
            newest
          </FilterPill>
        </div>
        <SyncButton />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `queue-filters.tsx`**

Move lines 211-353 of the current `page.tsx` **verbatim** — the wrapping
`<div className="mb-4 space-y-1.5 text-sm">` through its close, including the
block comment above it and every `title` string. Props: `params`, `filterUrl`.
Imports needed: `Link` from `next/link`, `FilterPill`/`FilterRow` from
`@/components/ui`.

There are no ternaries to extract here — every conditional is already a simple
`&&` guard or a `===` comparison.

- [ ] **Step 3: `queue-empty.tsx`**

Move lines 354-376 verbatim. Props: `{ awaiting?: string }`. Keep both
paragraphs and the full comment explaining why an empty awaiting-reply result
must not read as "nobody is waiting on us" — that comment is the reason the copy
is worded the way it is.

- [ ] **Step 4: `queue-row.tsx`**

Move lines 387-487 verbatim — the whole `<QueueCard>` body. Props:
`{ mention: TMention; filterUrl: (over: TQueueFilterOverrides) => string }`.
Name the prop `mention` rather than `m`, and destructure once at the top so the
JSX reads the same as before:

```tsx
export function QueueRow({ mention: m, filterUrl }: { ... }) {
```

Every `(m: any)` and `(t: any)` disappears: `m` is `TMention`, `t` is `TTopicRef`.
`commentCount` now comes from `@/lib/mentions`.

- [ ] **Step 5: `queue-pagination.tsx` — with the prev/next ternaries extracted**

```tsx
import Link from 'next/link'

import type { TPagination } from '@/types'

/**
 * One end of the pager. Was a ternary per side choosing between a Link and a
 * greyed span; the two arms differed only in whether the href was live, so the
 * decision belongs in one place rather than twice in the JSX.
 */
function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) {
    return (
      <span className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-400">
        {children}
      </span>
    )
  }
  return (
    <Link
      href={href}
      className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      {children}
    </Link>
  )
}

export function QueuePagination({
  pagination,
  pageUrl,
}: {
  pagination: TPagination
  pageUrl: (p: number) => string
}) {
  if (pagination.pageCount <= 1) return null

  const prev = pagination.page > 1 ? pageUrl(pagination.page - 1) : null
  const next = pagination.page < pagination.pageCount ? pageUrl(pagination.page + 1) : null

  return (
    <nav className="mt-6 flex items-center justify-center gap-4 text-sm" aria-label="Pagination">
      <PageLink href={prev}>← Prev</PageLink>
      <span className="text-zinc-500">
        Page {pagination.page} of {pagination.pageCount} · {pagination.total} mentions
      </span>
      <PageLink href={next}>Next →</PageLink>
    </nav>
  )
}
```

- [ ] **Step 6: Rewrite `apps/web/app/page.tsx`**

```tsx
import { fetchAllTopics } from '@/lib/strapi'
import { fetchQueue } from '@/lib/queue/fetch'
import { makeFilterUrl } from '@/lib/queue/filter-url'
import { buildCurrentSearch } from '@/lib/queue/current-search'
import { RememberQueueView } from '@/components/queue/queue-view-memory'
import { SelectionProvider, SelectionHint } from '@/components/queue/bulk-triage'
import { QueueHeader } from '@/components/queue/queue-header'
import { QueueFilters } from '@/components/queue/queue-filters'
import { QueueEmpty } from '@/components/queue/queue-empty'
import { QueueRow } from '@/components/queue/queue-row'
import { QueuePagination } from '@/components/queue/queue-pagination'
import type { TPagination, TQueueSearchParams } from '@/types'

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<TQueueSearchParams>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)

  const data = await fetchQueue(params, page)
  const topics = await fetchAllTopics().catch(() => [])

  const mentions = data.data ?? []
  // The server says whether it actually grouped: it falls back to a flat list
  // when the filtered set is too large to group honestly, and the label must
  // not claim otherwise.
  const grouped = data.meta?.grouped === true
  const pagination: TPagination = data.meta?.pagination ?? {
    page: 1,
    pageCount: 1,
    total: mentions.length,
  }

  const filterUrl = makeFilterUrl(params)
  const pageUrl = (p: number) => filterUrl({ page: p })

  return (
    <div>
      <RememberQueueView search={buildCurrentSearch(params, page)} />

      <QueueHeader
        params={params}
        grouped={grouped}
        total={pagination.total}
        filterUrl={filterUrl}
      />
      <QueueFilters params={params} filterUrl={filterUrl} />

      {mentions.length === 0 ? (
        <QueueEmpty awaiting={params.awaiting} />
      ) : (
        <SelectionProvider
          allIds={mentions.map((m) => m.documentId)}
          topics={topics.map((t) => ({ documentId: t.documentId, name: t.name }))}
        >
          <div className="mb-2">
            <SelectionHint count={mentions.length} />
          </div>
          <ul className="space-y-3">
            {mentions.map((m) => (
              <QueueRow key={m.documentId} mention={m} filterUrl={filterUrl} />
            ))}
          </ul>
        </SelectionProvider>
      )}

      <QueuePagination pagination={pagination} pageUrl={pageUrl} />
    </div>
  )
}
```

- [ ] **Step 7: Typecheck and build**

Run: `npx tsc --noEmit` then `npx next build`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/queue apps/web/app/page.tsx
git commit -m "refactor(queue): the page composes five components instead of being one"
```

---

### Task 5: Prove nothing changed

**Files:** none, unless a failure is found.

- [ ] **Step 1: Run the full suite**

The stack must be running. Every test must pass **with no edits to the spec
files** — an edit there would mean behaviour changed.

Run: `npx playwright test`
Expected: PASS, matching the pre-refactor baseline.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Lint — confirm the `any` count went down and nothing new appeared**

Run: `npx eslint app/page.tsx components/queue lib/queue types`
Expected: zero errors. Before this work `app/page.tsx` alone had 7.

- [ ] **Step 4: Confirm the complexity ceiling**

`page.tsx`'s default export should now contain: one `await`, one `Math.max`,
two `??` fallbacks, one `?:` and one arrow. That is well under 15. Verify by
reading it — if it is longer than ~60 lines, something did not get extracted.

- [ ] **Step 5: Commit any fixes**

Only if Steps 1-4 turned something up.

---

## Done when

- `app/page.tsx` is composition only, under 60 lines, no `any`.
- `types/index.ts` exists, `T`-prefixed; `lib/types.ts` is gone.
- Four nested ternaries are named values or components.
- Every comment from the original file survives, attached to the code it explains.
- `npx playwright test` passes with no edits to any existing spec, and `npm run build` succeeds.
