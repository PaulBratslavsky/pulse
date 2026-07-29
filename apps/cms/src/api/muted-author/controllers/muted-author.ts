import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::muted-author.muted-author', ({ strapi }) => ({
  /** Mute by handle (retroactive) — the "shadow block". */
  async mute(ctx) {
    const { handle, reason, note } = ctx.request.body ?? {}
    if (!handle || !String(handle).trim()) return ctx.badRequest('handle is required')
    if (reason && !['ai-spam', 'promo-spam', 'irrelevant', 'other'].includes(reason))
      return ctx.badRequest('invalid reason')
    const data = await (strapi.service('api::muted-author.muted-author') as any).mute(String(handle).trim(), {
      reason,
      note,
      userId: ctx.state.user?.id,
    })
    return { data }
  },

  async unmute(ctx) {
    const data = await (strapi.service('api::muted-author.muted-author') as any).unmute(ctx.params.documentId)
    if (!data.unmuted) return ctx.notFound('muted author not found')
    return { data }
  },
}))
