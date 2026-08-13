# Queue page refactor — design

**Date:** 2026-08-11
**Status:** approved, not yet implemented

## The problem

`app/page.tsx` is 516 lines and one function. SonarQube puts its cognitive
complexity at 37 against a ceiling of 15, contributed by 31 separate locations
inside that single function.

The number is a symptom. The page does four unrelated jobs in one body: it
builds a Strapi query out of a dozen conditional spreads, it fetches with a
fallback path, it builds filter URLs from eighteen near-identical lines, and it
renders roughly 350 lines of JSX. Nothing separates them, so reading any one of
them means scrolling past the other three.

It is also the least-typed file in the app. `let data: any`, `catch (err: any)`,
and five more `any` annotations mean the queue — the page the whole product
opens on — has no type safety over the shape it renders.

## What must not change

Every rendered pixel, every URL, and every filter. This is a refactor: the
existing `queue-and-detail.spec.ts` and `responsive.spec.ts` runs are the
contract, and they must pass untouched.

**The comments move with the code they explain.** This file's comments record
why grouping falls back to a flat list, why `'key' in over` is used rather than
`!== undefined`, and why the awaiting-reply filter can only ever work on Reddit.
That last one is a caveat about what the product cannot see. A refactor that
drops it makes the code worse no matter what it does to the complexity score.

## Types: `apps/web/types/index.ts`

Replaces `lib/types.ts`. Types only — `commentCount` is a function and moves to
`lib/mentions.ts`. Names take a `T` prefix, matching the convention in
`coding-after-thirty-next/src/types/index.ts`.

| group | types |
| --- | --- |
| API envelope | `TStrapiResponse<T>`, `TPagination`, `TStrapiError` |
| Route params | `TQueueSearchParams`, `TQueueFilterOverrides` |
| Domain | `TMention`, `TUserRef`, `TTopicRef`, `TChannelRef`, `TResponseRecord`, `TCommentEntry`, `TActivityEntry` |
| Unions | `TMentionStatus`, `TSentimentLabel`, `TOutcomeResult`, `TCommentKind`, `TLane` |

`TQueueSearchParams` and `TQueueFilterOverrides` are deliberately separate
types rather than one shared shape: the URL carries `page` as a string, the
override object takes it as a number, and collapsing them would mean lying about
one of the two.

Two importers get updated — `components/ui/index.tsx` (`UserRef` → `TUserRef`)
and the queue page.

## Logic: `apps/web/lib/queue/`

| file | exports | why it is separate |
| --- | --- | --- |
| `query.ts` | `buildQueueQuery(params, page, grouped)` | the filter spreads are a translation from URL to Strapi, testable with no React |
| `filter-url.ts` | `makeFilterUrl(params)` → `(over) => string` | eighteen repeated `'key' in over ? over.key : params.key` lines collapse into one loop over a key list |
| `fetch.ts` | `fetchQueue(params, page)` | the grouped-then-flat fallback and the 401/403 redirect are control flow, not rendering |
| `current-search.ts` | `buildCurrentSearch(params, page)` | the round-trip string that restores this exact view |

`filter-url.ts` is the biggest single win. The eighteen lines exist because each
filter key needs `'key' in over` semantics — an explicit `undefined` must CLEAR
a filter, which `?? params.key` would silently ignore. That behaviour is
preserved exactly; it just stops being written out once per key.

## Rendering: `apps/web/components/queue/`

`queue-header.tsx` (heading, count badge, subtitle, sort pills, sync button) ·
`queue-filters.tsx` (the five `FilterRow` axes) · `queue-empty.tsx` (including
the Reddit-blindness copy) · `queue-row.tsx` (one mention card) ·
`queue-pagination.tsx`.

`page.tsx` ends at roughly 50 lines: await the params, fetch, render five
components. Its cognitive complexity lands near 4.

## The nested ternaries

Four, each becoming a named value or a small component:

| where | becomes |
| --- | --- |
| count badge `title` | `countTitle` const in `queue-header.tsx` |
| the subtitle line | `subtitle` const in `queue-header.tsx` |
| lane filters in the query | `laneFilters(lane)` helper in `query.ts` |
| pagination prev/next Link-vs-span | a `<PageLink>` component |

## Error handling

Unchanged in behaviour, better in type. `strapiFetch` throws an error carrying
a `status`; the queue turns 401 and 403 into `redirect('/sign-in')` and lets
everything else propagate to the error boundary. Today that is read off `any`.
It gets a `TStrapiError` type guard — `isAuthError(err)` — so the check is a
function with a name rather than a property access on an untyped value.

The grouped-fetch fallback keeps its exact shape: try grouped, and if the server
rejects it, retry flat once. The reason is recorded in the existing comment and
moves with the code — an older CMS 400s on the `group` param, and the deploy
window where that happens must degrade to a worse view rather than a broken page.

## Testing

`buildQueueQuery`, `makeFilterUrl` and `buildCurrentSearch` are pure functions
over plain objects, so they get a table-driven spec in the server-free `unit`
Playwright project:

- every filter key present, absent, and explicitly cleared
- the lane default (`respond` + `lead`), `lane=all`, and a specific lane
- `'key' in over` semantics: passing `undefined` clears, omitting inherits
- `page` omitted from the URL when it is 1

The regression net is the existing suite. `queue-and-detail.spec.ts` walks the
queue's filters, search, keyboard triage and bulk triage; `responsive.spec.ts`
asserts the page does not scroll horizontally at three viewports. Both must pass
with no edits — an edit to those files during this work would mean behaviour
changed.

Plus `next build`, and a SonarQube-equivalent check that the page function is
under the 15 ceiling.
