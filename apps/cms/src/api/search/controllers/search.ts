/**
 * v1 search: case-insensitive contains via the query engine — portable across
 * SQLite (dev) and Postgres (prod). Upgrade path (documented in the build spec):
 * Postgres tsvector via a raw query in this controller when volume demands it.
 *
 * The query is split into TERMS and every term must appear. It used to match
 * the whole string as one literal, which meant anything longer than a phrase
 * could only match byte-for-byte — including whitespace. Pasting a paragraph
 * out of a mention to find it again returned "No matches", because the stored
 * text had a line break where the clipboard had a space. Pasting the thing you
 * are looking for is the most natural way to search, and it was the one input
 * guaranteed to fail.
 *
 * Order-independent by consequence, which is also what people expect: "R2
 * Cloudflare" finds the same post as "Cloudflare R2".
 */
const MAX_TERMS = 12

/** Every term must appear in at least one of `fields` (AND across terms, OR across fields). */
const allTerms = (terms: string[], fields: string[]) => ({
  $and: terms.map((t) => ({ $or: fields.map((f) => ({ [f]: { $containsi: t } })) })),
})
export default {
  async query(ctx: any) {
    const q = String(ctx.query.q ?? '').trim()
    if (q.length < 2) return ctx.badRequest('q must be at least 2 characters')

    // Cap the term count: a pasted wall of text would otherwise become a
    // hundred ANDed LIKEs, and past a dozen words the extra terms only narrow
    // an already-unique match.
    const terms = q.split(/\s+/).filter((t) => t.length > 1).slice(0, MAX_TERMS)
    if (!terms.length) return ctx.badRequest('q must contain a word of at least 2 characters')

    const [mentions, responses, comments] = await Promise.all([
      strapi.documents('api::mention.mention').findMany({
        filters: {
          ...allTerms(terms, ['content']),
          $or: [{ quality: { $null: true } }, { quality: { $ne: 'spam' } }],
        },
        fields: ['content', 'sentimentLabel', 'status', 'postedAt', 'url'],
        populate: { channel: { fields: ['name'] }, topics: { fields: ['name', 'slug'] } } as any,
        sort: 'postedAt:desc' as any,
        limit: 25,
      }),
      strapi.documents('api::response.response').findMany({
        filters: {
          archived: { $ne: true },
          ...allTerms(terms, ['finalText', 'notes']),
        },
        fields: ['finalText', 'notes', 'respondedAt'],
        populate: {
          mention: { fields: ['content', 'status', 'url'] },
          respondedBy: { fields: ['username'] },
          outcome: true,
        } as any,
        sort: 'respondedAt:desc' as any,
        limit: 25,
      }),
      strapi.documents('api::comment.comment').findMany({
        filters: { ...allTerms(terms, ['body']), archived: { $ne: true } },
        fields: ['kind', 'body', 'links', 'createdAt'],
        populate: {
          mention: { fields: ['content', 'status', 'url'] },
          author: { fields: ['username'] },
        } as any,
        sort: 'createdAt:desc' as any,
        limit: 25,
      }),
    ])

    return {
      data: {
        query: q,
        mentions: mentions.map((m: any) => ({ type: 'mention', ...m })),
        responses: responses.map((r: any) => ({ type: 'response', ...r })),
        comments: comments.map((c: any) => ({ type: 'comment', ...c })),
      },
    }
  },
}
