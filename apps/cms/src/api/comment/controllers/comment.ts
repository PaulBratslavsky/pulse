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
    const { mentionDocumentId, kind, body, links } = ctx.request.body?.data ?? ctx.request.body ?? {}
    if (!mentionDocumentId || !String(body ?? '').trim()) {
      return ctx.badRequest('mentionDocumentId and body are required')
    }
    if (kind && !['note', 'comment'].includes(kind)) return ctx.badRequest('invalid kind')
    const cleanLinks = validateLinks(links)
    if (cleanLinks === null) return ctx.badRequest(`links must be up to ${MAX_LINKS} http(s) URLs`)

    const mention = await strapi.documents('api::mention.mention').findOne({ documentId: mentionDocumentId })
    if (!mention) return ctx.badRequest('mention not found')

    const comment = await strapi.documents('api::comment.comment').create({
      data: {
        mention: mentionDocumentId,
        kind: kind ?? 'comment',
        body: String(body).trim(),
        links: cleanLinks,
        author: user.id,
      } as any,
    })
    return { data: comment }
  },
}))
