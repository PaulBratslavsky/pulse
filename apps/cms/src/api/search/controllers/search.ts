/**
 * v1 search: case-insensitive contains via the query engine — portable across
 * SQLite (dev) and Postgres (prod). Upgrade path (documented in the build spec):
 * Postgres tsvector via a raw query in this controller when volume demands it.
 */
export default {
  async query(ctx: any) {
    const q = String(ctx.query.q ?? '').trim()
    if (q.length < 2) return ctx.badRequest('q must be at least 2 characters')

    const [mentions, responses] = await Promise.all([
      strapi.documents('api::mention.mention').findMany({
        filters: { content: { $containsi: q } },
        fields: ['content', 'sentimentLabel', 'status', 'postedAt', 'url'],
        populate: { channel: { fields: ['name'] }, topics: { fields: ['name', 'slug'] } } as any,
        sort: 'postedAt:desc' as any,
        pagination: { limit: 25 } as any,
      }),
      strapi.documents('api::response.response').findMany({
        filters: {
          $or: [{ finalText: { $containsi: q } }, { notes: { $containsi: q } }],
        },
        fields: ['finalText', 'notes', 'respondedAt'],
        populate: {
          mention: { fields: ['content', 'status', 'url'] },
          respondedBy: { fields: ['username'] },
          outcome: true,
        } as any,
        sort: 'respondedAt:desc' as any,
        pagination: { limit: 25 } as any,
      }),
    ])

    return {
      data: {
        query: q,
        mentions: mentions.map((m: any) => ({ type: 'mention', ...m })),
        responses: responses.map((r: any) => ({ type: 'response', ...r })),
      },
    }
  },
}
