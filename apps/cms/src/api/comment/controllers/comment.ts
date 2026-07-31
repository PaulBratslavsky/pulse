import { factories } from '@strapi/strapi'

const MAX_LINKS = 10

/** Accept only http(s) URLs; anything else is dropped with a 400. */
const validateLinks = (links: unknown): string[] | null => {
  if (links == null) return []
  if (!Array.isArray(links) || links.length > MAX_LINKS) return null
  const clean: string[] = []
  for (const raw of links) {
    try {
      const u = new URL(String(raw))
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      clean.push(u.toString())
    } catch {
      return null
    }
  }
  return clean
}

export default factories.createCoreController('api::comment.comment', ({ strapi }) => ({
  /** Overridden create: author is server-set, kind/body/links validated,
   *  no workflow side effects — comments/notes never change mention status. */
  async create(ctx) {
    const user = ctx.state.user
    const { mentionDocumentId, personDocumentId, kind, body, links, tags } =
      ctx.request.body?.data ?? ctx.request.body ?? {}
    // A comment hangs off a mention OR a person, never both. Person notes reuse
    // this controller rather than a parallel endpoint so they inherit editing,
    // ownership and link validation — and because insights.feedback() filters
    // on `c.mention &&`, they stay out of the product-feedback digest for free.
    if (!mentionDocumentId && !personDocumentId) {
      return ctx.badRequest('mentionDocumentId or personDocumentId is required')
    }
    if (!String(body ?? '').trim()) return ctx.badRequest('body is required')
    if (kind && !['note', 'comment', 'feedback'].includes(kind)) return ctx.badRequest('invalid kind')
    const cleanLinks = validateLinks(links)
    if (cleanLinks === null) return ctx.badRequest(`links must be up to ${MAX_LINKS} http(s) URLs`)

    if (mentionDocumentId) {
      const mention = await strapi
        .documents('api::mention.mention')
        .findOne({ documentId: mentionDocumentId })
      if (!mention) return ctx.badRequest('mention not found')
    } else {
      const person = await strapi
        .documents('api::person.person')
        .findOne({ documentId: personDocumentId })
      if (!person) return ctx.badRequest('person not found')
    }

    // tags reuse the shared topic vocabulary (race-safe ensure), so product
    // areas stay curated in one place instead of a parallel free-text list
    const topicIds = Array.isArray(tags) && tags.length
      ? await (strapi.service('api::topic.topic') as any).ensure(tags.slice(0, 10), 'feature')
      : []

    const comment = await strapi.documents('api::comment.comment').create({
      data: {
        mention: mentionDocumentId ?? null,
        person: personDocumentId ?? null,
        kind: kind ?? 'comment',
        body: String(body).trim(),
        links: cleanLinks,
        ...(topicIds.length ? { topics: topicIds } : {}),
        author: user.id,
      } as any,
    })
    return { data: comment }
  },

  /** Overridden update (is-owner middleware guards ownership): only body,
   *  links, and kind are editable — author and mention are immutable. */
  async update(ctx) {
    const documentId = ctx.params.documentId ?? ctx.params.id
    const { kind, body, links, tags } = ctx.request.body?.data ?? ctx.request.body ?? {}

    const data: Record<string, unknown> = {}
    if (body !== undefined) {
      if (!String(body).trim()) return ctx.badRequest('body cannot be empty')
      data.body = String(body).trim()
    }
    if (kind !== undefined) {
      if (!['note', 'comment', 'feedback'].includes(kind)) return ctx.badRequest('invalid kind')
      data.kind = kind
    }
    if (links !== undefined) {
      const cleanLinks = validateLinks(links)
      if (cleanLinks === null) return ctx.badRequest(`links must be up to ${MAX_LINKS} http(s) URLs`)
      data.links = cleanLinks
    }
    if (Array.isArray(tags)) {
      data.topics = tags.length
        ? await (strapi.service('api::topic.topic') as any).ensure(tags.slice(0, 10), 'feature')
        : []
    }
    if (!Object.keys(data).length) return ctx.badRequest('nothing to update')
    data.editedAt = new Date().toISOString()

    const updated = await strapi.documents('api::comment.comment').update({ documentId, data: data as any })
    return { data: updated }
  },

  /** Soft delete (is-owner middleware guards ownership): comments are never
   *  destroyed — DELETE flips `archived`, and every read path filters it out.
   *  Full history stays in the database / admin panel. */
  async delete(ctx) {
    const documentId = ctx.params.documentId ?? ctx.params.id
    await strapi.documents('api::comment.comment').update({
      documentId,
      data: { archived: true } as any,
    })
    return { data: { documentId, archived: true } }
  },
}))
