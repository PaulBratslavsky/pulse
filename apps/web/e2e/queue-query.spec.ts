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

/**
 * The bug this branch found: `awaiting` was declared in the override type and
 * never written, so the "awaiting reply" pill linked to a URL without the param
 * and could never go active. The filter itself always worked — the page reads
 * params.awaiting — so only the route in was dead.
 */
test('filterUrl: the awaiting pill actually carries its filter', () => {
  expect(makeFilterUrl({})({ awaiting: '1' })).toBe('/?awaiting=1')
})

test('filterUrl: awaiting inherits and clears like every other filter', () => {
  expect(makeFilterUrl({ awaiting: '1' })({ sentiment: 'negative' })).toContain('awaiting=1')
  expect(makeFilterUrl({ awaiting: '1' })({ awaiting: undefined })).toBe('/')
})

test('currentSearch: carries the live filters and omits page 1', () => {
  const s = buildCurrentSearch({ status: 'claimed', q: 'strapi' }, 1)
  expect(s).toContain('status=claimed')
  expect(s).toContain('q=strapi')
  expect(s).not.toContain('page=')
  expect(buildCurrentSearch({}, 4)).toContain('page=4')
})
