import type { Core } from '@strapi/strapi';

/**
 * One row per conversation, instead of one row per message.
 *
 * Octolens ingests every comment in a thread as its own mention, so a single
 * Reddit exchange arrives as N unrelated queue rows. The corpus has a 22-message
 * thread in it: twenty-two things that each look like unclaimed work, none of
 * which says it is part of the same discussion, and the ONE message actually
 * waiting on a reply is indistinguishable from the twenty-one already handled.
 * That is how a follow-up sat unanswered for three days while the reply was
 * eventually written by hand on Reddit.
 *
 * Collapsing happens here rather than in SQL because the queue's filters (lane,
 * quality, topic, search, sentiment, awaiting…) are built by the web app as REST
 * params. Re-expressing them as a raw grouped query would mean two filter
 * implementations that must agree forever — and the one that silently drifts is
 * the one nobody is reading. So we run the caller's own filters, unchanged, and
 * group the result.
 *
 * The representative is the message that most needs a human:
 *   1. one that awaits a reply — someone answered us and nobody answered them
 *   2. otherwise the newest, which is where the conversation actually is
 *
 * Cost is one narrow query (three fields, no populate) over the filtered set.
 * If that set is larger than the cap, we do NOT silently return a partial
 * grouping — we say so and the caller falls back to the flat list, because a
 * queue that quietly drops rows is worse than a queue that repeats them.
 */
const SCAN_CAP = 5000;

export type Collapsed = {
  /** documentIds of the representatives, in the caller's sort order */
  documentIds: string[];
  /** total conversations (+ solo mentions) matching the filters */
  total: number;
  /** documentId → how many messages that row stands for (>1 only) */
  sizes: Record<string, number>;
  /** true when the filtered set was too large to group honestly */
  tooLarge: boolean;
};

export async function collapseThreads(
  strapi: Core.Strapi,
  query: any,
  page: number,
  pageSize: number
): Promise<Collapsed> {
  // The caller's filters and sort, verbatim — only the projection and paging
  // are ours.
  //
  // The Document Service, NOT the core find(): `maxLimit: 100` in config/api.ts
  // clamps a REST-shaped query no matter what page size you ask for, so the
  // first attempt scanned 100 of 747 rows and reported the 94 conversations it
  // found in them as the whole queue. A cap that silently truncates the input
  // to a grouping is indistinguishable from a smaller queue.
  const rows: any[] = await strapi.documents('api::mention.mention').findMany({
    filters: (query as any).filters,
    sort: (query as any).sort,
    // documentId is not implied by a fields projection; without it every
    // unthreaded row keys as `solo:undefined` and they all fold into one
    fields: ['documentId', 'threadKey', 'awaitsReply', 'postedAt'] as any,
    limit: SCAN_CAP + 1,
  } as any);
  if (rows.length > SCAN_CAP) {
    return { documentIds: [], total: 0, sizes: {}, tooLarge: true };
  }

  // Insertion order IS the caller's sort order, so the first member of each
  // thread we meet already sits where the conversation belongs in the list.
  const order: string[] = [];
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    // A mention with no threadKey is its own conversation. Keying it by its own
    // id keeps one code path instead of two.
    const key = r.threadKey || `solo:${r.documentId}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(r);
  }

  const at = (m: any) => new Date(m.postedAt ?? 0).getTime();
  const documentIds: string[] = [];
  const sizes: Record<string, number> = {};
  for (const key of order) {
    const members = groups.get(key)!;
    const waiting = members.find((m) => m.awaitsReply);
    const rep = waiting ?? members.reduce((a, b) => (at(b) >= at(a) ? b : a));
    documentIds.push(rep.documentId);
    if (members.length > 1) sizes[rep.documentId] = members.length;
  }

  const start = (page - 1) * pageSize;
  return {
    documentIds: documentIds.slice(start, start + pageSize),
    total: documentIds.length,
    sizes,
    tooLarge: false,
  };
}
