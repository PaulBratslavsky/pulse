/**
 * `is-owner` route middleware — you may edit or withdraw only the replies you
 * recorded. Mirrors api::comment.is-owner against the `respondedBy` relation.
 *
 * A response is a claim about what a specific person posted publicly under
 * their own name, so someone else rewriting it is a different act from fixing a
 * shared note. If the team later needs to correct each other's records, that
 * should be a deliberate decision with its own trail, not a quietly relaxed
 * guard.
 *
 * API-scoped: this file must live in src/api/response/middlewares/ for the UID
 * api::response.is-owner to resolve.
 */
import type { Core } from '@strapi/strapi'

export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: any, next: () => Promise<void>) => {
    const user = ctx.state.user
    if (!user?.documentId) return ctx.unauthorized('You must be authenticated')

    // core router names the param :id — it carries the documentId in v5
    const documentId = ctx.params.documentId ?? ctx.params.id
    if (!documentId) return ctx.badRequest('missing response id')

    const entry: any = await strapi.documents('api::response.response').findOne({
      documentId,
      populate: { respondedBy: true } as any,
    })
    if (!entry) return ctx.notFound('response not found')

    if (entry.respondedBy?.documentId !== user.documentId) {
      return ctx.forbidden('You can only edit a reply you recorded')
    }

    await next()
  }
