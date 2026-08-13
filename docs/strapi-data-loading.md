# Loading data from Strapi — the pattern

How the Next.js frontend talks to the CMS. Four layers, each with one job, and a
rule about what is allowed to know about what.

```
types/index.ts      the shapes            ← knows nothing
lib/data-api.ts     the transport         ← knows HTTP, auth, timeouts
lib/loaders.ts      the queries           ← knows Strapi's URL shapes
app/**/page.tsx     the render            ← knows only loaders and types
```

The direction is one-way. A page never builds a URL, never calls `fetch`, and
never sees a status code it did not ask about. A loader never renders. The
transport never knows what a mention is.

---

## 1. Types

Everything a response can be, in one file, `T`-prefixed so an import reads as a
contract rather than a local alias.

```ts
export type TStrapiResponse<T> = {
  data?: T
  meta?: { pagination?: TPagination }
  error?: TStrapiError
  success: boolean
  status: number
}

export type TStrapiError = { status: number; name: string; message: string }
export type TPagination = { page: number; pageSize?: number; pageCount: number; total: number }
```

`success` is the discriminant. Narrow on it and TypeScript gives you `data`:

```ts
const res = await loaders.getQueue(params)
if (!res.success) return <ErrorState error={res.error} />
res.data // narrowed, no ! and no ??
```

## 2. Transport — one function, every method

One place that knows about headers, bearer tokens, timeouts, and what a failure
looks like. Nothing else in the app calls `fetch`.

```ts
type THTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type TApiOptions<P = Record<string, unknown>> = {
  method: THTTPMethod
  payload?: P
  timeoutMs?: number
  authToken?: string
}
```

**Timeouts are not optional.** An `AbortController` with a default deadline —
8 seconds is a reasonable balance — wrapped so the timer is always cleared:

```ts
async function apiWithTimeout(input: RequestInfo, init: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    // runs whether the request succeeded, failed, or timed out
    clearTimeout(timeout)
  }
}
```

Without this a hung CMS holds a server render open until the platform kills it,
and the user sees a spinner rather than an error they can act on.

Then the ergonomic surface:

```ts
export const api = {
  get: <T>(url: string, o: TRequestOptions = {}) => apiRequest<T>(url, { method: 'GET', ...o }),
  post: <T, P>(url: string, payload: P, o: TRequestOptions = {}) =>
    apiRequest<T, P>(url, { method: 'POST', payload, ...o }),
  put: /* … */,
  patch: /* … */,
  delete: <T>(url: string, o: TRequestOptions = {}) =>
    apiRequest<T>(url, { method: 'DELETE', ...o }),
}
```

Three details worth stating because they are easy to get wrong:

- **`GET` and `DELETE` send no body.** Serialising `{}` into a GET makes some
  proxies reject it.
- **`DELETE` may return no JSON.** Parsing it unconditionally throws on a 204.
  Branch on the method before reading the body.
- **Unwrap Strapi's envelope once.** Strapi returns `{ data, meta }`; returning
  `{ data: { data, meta } }` means every call site writes `res.data.data`.

## 3. Auth — per request, not per module

**This is where Pulse differs from a public site, and copying the public-site
version is a security bug, not a style choice.**

A public marketing site holds one API key for everyone:

```ts
const authToken = process.env.STRAPI_API_KEY  // ← WRONG for Pulse
```

Pulse is authenticated per user. The session is a Strapi Users & Permissions
JWT in an httpOnly cookie (`pulse_jwt`), and the CMS uses it to decide what this
person may see and to attribute what they do. A module-level constant is
evaluated once per process, so it would either be empty or — worse — pin one
user's token for every subsequent render the server handles.

Resolve it inside the request:

```ts
import { cookies } from 'next/headers'

async function authToken(): Promise<string | undefined> {
  return (await cookies()).get('pulse_jwt')?.value
}

export async function getQueue(params: TQueueSearchParams) {
  return api.get<TMention[]>(url.href, { authToken: await authToken() })
}
```

`cookies()` also opts the route out of static rendering, which is correct: a
queue is per-user and must never be cached across sessions.

## 4. Loaders — the only place a Strapi URL is written

One named function per thing a page needs. The name says what you get; the body
says how it is fetched. A page importing `loaders.getQueue` cannot accidentally
depend on the shape of a `populate`.

```ts
import qs from 'qs'

const baseUrl = getStrapiURL()

async function getCourseBySlug(slug: string): Promise<TStrapiResponse<TCourse[]>> {
  const query = qs.stringify({
    filters: { slug },
    populate: { lessons: { fields: ['slug', 'title', 'description', 'documentId'] } },
  })
  const url = new URL('/api/courses', baseUrl)
  url.search = query
  return api.get<TCourse[]>(url.href, { authToken: await authToken() })
}

export const loaders = { getCourseBySlug /* , … */ }
```

**Use `qs`, and write queries nested rather than flattened.** Strapi parses
incoming query strings with `qs`, so stringifying with it is round-tripping
through the same library rather than guessing at a format. These are the same
request:

```ts
// flattened by hand — an index typo is silent, and nothing checks the pairing
{ 'filters[lane][$in][0]': 'respond', 'filters[lane][$in][1]': 'lead' }

// nested — says what it means, and the indices cannot drift
{ filters: { lane: { $in: ['respond', 'lead'] } } }
```

The flattened form is what `qs.stringify` produces. Writing it by hand means
maintaining a serialiser's output as source.

**Pass `encodeValuesOnly: true`.** Values still get encoded; the brackets stay
readable. Strapi parses either form, and an unreadable URL costs an hour the
first time a filter misbehaves.

**Use `new URL()` rather than string concatenation.** It normalises double
slashes and makes a missing base fail loudly at the seam instead of producing a
404 three layers away.

### Populate: name what you want

Strapi's own guidance, in
[Demystifying Strapi's populate and filtering](https://strapi.io/blog/demystifying-strapi-s-populate-and-filtering):

- **Never ship `populate: '*'`.** It over-fetches relations the page does not
  render, it only goes one level deep anyway so it rarely does what people
  expect, and it can expose fields nobody meant to publish.
- **Write the populate yourself.** Their words: you should be the one writing
  the populate and filtering logic, not a Populate Deep plugin. A plugin that
  guesses depth is a performance problem you cannot see from the call site.
- **Select fields on every relation** rather than pulling whole entities:

```ts
populate: {
  image: { fields: ['url', 'alternativeText'] },
  category: true,
}
```

- **Dynamic zones need the `on` syntax**, keyed by component UID, not
  `populate: true`:

```ts
populate: {
  blocks: {
    on: {
      'blocks.hero': { populate: { image: { fields: ['url'] }, links: true } },
      'blocks.card-carousel': { populate: { cards: true } },
    },
  },
}
```

Useful v5 operators: `$eq`, `$eqi` (case-insensitive), `$containsi`, `$null` /
`$notNull`, `$in`, `$between`, and `$and` / `$or` for compound conditions.

## 5. Rules

**Do**

- Put every Strapi URL in a loader. If a page contains `/api/`, it is in the
  wrong layer.
- Return errors as values. A caller that must handle a failure should be told so
  by the type, not by a stack trace at runtime.
- Give every request a timeout.
- Type the generic at the call site — `api.get<TMention[]>` — so the loader's
  return type is checked against what it claims.
- Let a loader fail loudly for data the page cannot render without, and fall
  back for data it can (`getTopics().catch(() => [])` for a filter list is
  fine; the queue itself is not).

**Don't**

- Call `fetch` in a component. There is one transport.
- Read an auth token at module scope. See §3.
- Return `any`. `TStrapiResponse<unknown>` is honest; `any` is a hole.
- Swallow `redirect()`. Next implements it by throwing a sentinel to unwind the
  render, so a `catch` that does not rethrow turns a redirect into a blank page.
- Log a token, a cookie, or a full request header in an error path.

## 6. The migration off the throwing client — done

`lib/strapi.ts` is gone. All 37 call sites across 13 files moved onto
`loaders`, and no file outside `lib/data-api.ts` calls `fetch`.

Two things worth carrying forward from doing it:

- **Type against the renderer, not against a guess.** Where a component already
  declared its props — `TrendChart`, `GraphView`, the MCP panel, the lead
  profile form — those types became the payload types. Where the renderer was
  still untyped, the payload type stayed deliberately permissive rather than
  inventing a shape nothing could check.
- **The compiler catches wrong guesses.** Two of ours: `leadContext.decayApplied`
  is a multiplier compared against `1`, not a boolean flag, and the
  acknowledged-by-reason rows are read as `.name`, not `.reason`.

The shape of each call site after the move, for reference:

```ts
// before
try {
  const data = await strapiFetch('/api/mentions')
} catch (err) {
  if (err.status === 401 || err.status === 403) redirect('/sign-in')
  throw err
}

// after
const res = await loaders.getMentions()
if (isAuthError(res)) redirect('/sign-in')
if (!res.success) throw new Error(res.error?.message ?? 'failed to load mentions')
```

`isAuthError(res)` is one helper checking `res.status === 401 || res.status === 403`,
so the rule lives in one place rather than being retyped a dozen times.
