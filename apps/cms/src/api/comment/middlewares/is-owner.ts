/**
 * `is-owner` route middleware — users may update/delete ONLY their own
 * comments/notes. Adapted from the reference pattern
 * (PaulBratslavsky/strapi-tanstack-start-starter, server/src/middlewares/is-owner.ts)
 * to this API's `author` relation. API-scoped: file must live in
 * src/api/comment/middlewares/ so the UID api::comment.is-owner resolves.
 */
import type { Core } from '@strapi/strapi'

export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: any, next: () => Promise<void>) => {
    const user = ctx.state.user
    if (!user?.documentId) return ctx.unauthorized('You must be authenticated')

    // core router names the param :id — it carries the documentId in v5
    const documentId = ctx.params.documentId ?? ctx.params.id
    if (!documentId) return ctx.badRequest('missing comment id')

    const entry: any = await strapi.documents('api::comment.comment').findOne({
      documentId,
      populate: { author: true } as any,
    })
    if (!entry) return ctx.notFound('comment not found')

    if (entry.author?.documentId !== user.documentId) {
      return ctx.forbidden('You can only modify your own comments')
    }

    await next()
  }
