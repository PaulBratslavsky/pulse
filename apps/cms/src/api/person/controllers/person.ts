import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::person.person', ({ strapi }) => ({
  /** GET /people/leads — the leads board, ordered by score. */
  async leads(ctx) {
    const { band, status, direction } = ctx.query as Record<string, string>
    const filters: any = {
      // people with no intent signal at all are not leads; showing them would
      // bury the 30-odd rows that matter under 300 that don't
      leadScore: { $gt: 0 },
      kind: { $in: ['community', 'unknown'] },
      mergedInto: { $null: true },
    }
    if (band) filters.leadBand = band
    if (status) filters.status = status

    const people = await strapi.documents('api::person.person').findMany({
      filters,
      populate: { channel: true, owner: true } as any,
      sort: ['leadScore:desc', 'lastSeenAt:desc'] as any,
      limit: 200,
    })

    const shaped = people
      .map((p: any) => ({
        documentId: p.documentId,
        handle: p.handle,
        displayName: p.displayName,
        profileUrl: p.profileUrl,
        avatarUrl: p.avatarUrl,
        channel: p.channel?.key ?? null,
        leadScore: p.leadScore,
        leadBand: p.leadBand,
        reachTier: p.reachTier,
        followers: p.followers,
        leadContext: p.leadContext ?? {},
        status: p.status,
        owner: p.owner ? { id: p.owner.id, username: p.owner.username } : null,
        mentionCount: p.mentionCount,
        lastSeenAt: p.lastSeenAt,
        direction: (p.leadContext as any)?.direction ?? 'none',
      }))
      .filter((p: any) => !direction || p.direction === direction)

    return { data: shaped }
  },

  /** GET /people/:documentId — one person with their mentions and notes. */
  async detail(ctx) {
    const person: any = await strapi.documents('api::person.person').findOne({
      documentId: ctx.params.documentId,
      populate: { channel: true, owner: true, mentions: { populate: { channel: true } } } as any,
    })
    if (!person) return ctx.notFound('person not found')
    const notes = await strapi.documents('api::comment.comment').findMany({
      filters: { person: { documentId: person.documentId } } as any,
      populate: { author: true } as any,
      sort: 'createdAt:desc' as any,
    })
    return {
      data: {
        ...person,
        owner: person.owner ? { id: person.owner.id, username: person.owner.username } : null,
        notes: notes.map((n: any) => ({
          documentId: n.documentId,
          body: n.body,
          author: n.author?.username ?? null,
          createdAt: n.createdAt,
        })),
      },
    }
  },

  /** POST /people/:documentId/status — { status } */
  async status(ctx) {
    try {
      const data = await (strapi.service('api::person.leads') as any).setStatus(
        ctx.params.documentId,
        ctx.request.body?.status,
        ctx.state.user
      )
      return { data }
    } catch (err: any) {
      if (err.status === 404) return ctx.notFound(err.message)
      return ctx.badRequest(err.message)
    }
  },

  /** POST /people/:documentId/note — { body } */
  async note(ctx) {
    const body = String(ctx.request.body?.body ?? '').trim()
    if (!body) return ctx.badRequest('body is required')
    const person = await strapi
      .documents('api::person.person')
      .findOne({ documentId: ctx.params.documentId })
    if (!person) return ctx.notFound('person not found')
    const note = await strapi.documents('api::comment.comment').create({
      data: {
        body,
        person: person.documentId,
        author: ctx.state.user?.id ?? null,
        kind: 'note',
      } as any,
    })
    return { data: note }
  },

  /** POST /people/rescore — pure arithmetic over stored rows, no model calls. */
  async rescore(ctx) {
    const count = await (strapi.service('api::person.leads') as any).rescoreAll()
    return { data: { scored: count } }
  },
}))
