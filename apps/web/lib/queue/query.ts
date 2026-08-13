import type { TQueueSearchParams } from '@/types'

/**
 * Lanes: the queue is REPLY work. Competitor/industry discourse is kept in full
 * and still feeds trends and themes — it just doesn't belong in a list a human
 * works through. ~2/3 of ingest is that.
 *
 * Extracted from a nested ternary in the page body: three outcomes reading as
 * one expression is where this file's complexity came from. Returning undefined
 * for "all" lets the caller drop the key rather than send an empty filter.
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
 * parses query strings with.
 *
 * `grouped` is a parameter rather than read from `params` because the caller
 * retries with it off — see lib/queue/fetch.ts.
 */
export function buildQueueQuery(params: TQueueSearchParams, page: number, grouped: boolean) {
  const lane = laneFilter(params.lane)

  return {
    filters: {
      // A one-element $in rather than $eq when a status is named, matching what
      // this query has always sent.
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
      ...(lane ? { lane } : {}),
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
