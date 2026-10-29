import { factories } from '@strapi/strapi'
import { SourceError, SourceNotConfigured } from '../services/source'

/** Thin wrappers — logic lives in api::resource.resource and api::resource.source. */
export default factories.createCoreController('api::resource.resource', ({ strapi }) => {
  const resources = () => strapi.service('api::resource.resource') as any
  const source = () => strapi.service('api::resource.source') as any

  /**
   * Source failures are the marketing site's, not ours: say so with a 502/503.
   * Anything else (our own database) is rethrown, so it is not blamed on the
   * marketing site.
   */
  const sourceError = (ctx: any, err: any) => {
    if (err instanceof SourceNotConfigured) return ctx.serviceUnavailable(err.message)
    if (!(err instanceof SourceError)) throw err
    strapi.log.warn(`[resources] marketing source failed: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`)
    ctx.status = 502
    ctx.body = { data: null, error: { status: 502, name: 'BadGateway', message: `Marketing site: ${err.message}` } }
  }

  return {
    async list(ctx) {
      const { q, includeHidden } = ctx.query as any
      return { data: await resources().listSaved({ q, includeHidden: includeHidden === 'true' }) }
    },

    async save(ctx) {
      const { sourceId, note } = (ctx.request.body as any)?.data ?? ctx.request.body ?? {}
      if (typeof sourceId !== 'string' || !sourceId) return ctx.badRequest('sourceId is required')
      if (note != null && typeof note !== 'string') return ctx.badRequest('note must be a string')
      try {
        const saved = await resources().save({ sourceId, note }, ctx.state.user?.id)
        if (!saved) return ctx.notFound('That post is not published on the marketing site')
        return { data: saved }
      } catch (err: any) {
        return sourceError(ctx, err)
      }
    },

    async patch(ctx) {
      const body = (ctx.request.body as any)?.data ?? ctx.request.body ?? {}
      const updated = await resources().patch(ctx.params.documentId, body)
      if (!updated) return ctx.notFound()
      return { data: updated }
    },

    async remove(ctx) {
      const removed = await resources().remove(ctx.params.documentId)
      if (!removed) return ctx.notFound()
      return { data: { documentId: ctx.params.documentId } }
    },

    async searchSource(ctx) {
      const { q, page, since, hideOld, exclude } = ctx.query as any
      if (typeof q !== 'string' || q.trim().length < 2) return ctx.badRequest('q must be at least 2 characters')
      try {
        const { results, hidden, categories, pagination } = await source().search(q, {
          page: Number(page) || 1,
          since: typeof since === 'string' && since ? since : null,
          hideOldVersions: hideOld === 'true',
          excludeCategories: typeof exclude === 'string' && exclude ? exclude.split(',') : [],
        })
        const saved: Map<string, string> = await resources().savedSourceIds(results.map((r: any) => r.sourceId))
        // searchText is for matching inside Pulse; the browser never needs it
        const data = results.map(({ searchText, ...post }: any) => ({ ...post, savedId: saved.get(post.sourceId) ?? null }))
        return { data, meta: { pagination, hidden, categories } }
      } catch (err: any) {
        return sourceError(ctx, err)
      }
    },

    /** Blog posts already linked in past replies that are not saved yet. */
    async sharedBefore(ctx) {
      try {
        return { data: await resources().sharedBefore() }
      } catch (err: any) {
        return sourceError(ctx, err)
      }
    },

    async forMention(ctx) {
      const limit = Math.min(Math.max(Number((ctx.query as any).limit) || 5, 1), 20)
      const matches = await (strapi.service('api::resource.match') as any).forMention(ctx.params.documentId, limit)
      if (!matches) return ctx.notFound('Mention not found')
      return { data: matches }
    },

    /** Kicks the refresh off and returns; it can outlive a request timeout. */
    async refresh(ctx) {
      if (!(await source().configured())) return ctx.serviceUnavailable(new SourceNotConfigured().message)
      resources()
        .refresh()
        .catch((err: any) => strapi.log.error(`[resources] refresh failed: ${err.message}`))
      ctx.status = 202
      return { data: { started: true } }
    },
  }
})
