import { factories } from '@strapi/strapi'

const REASONS = ['not-a-competitor', 'off-topic', 'too-noisy', 'other']

export default factories.createCoreController('api::muted-topic.muted-topic', ({ strapi }) => ({
  /** Mute a topic by slug (retroactive). */
  async mute(ctx) {
    const { slug, reason, note } = ctx.request.body ?? {}
    if (!slug || !String(slug).trim()) return ctx.badRequest('slug is required')
    if (reason && !REASONS.includes(reason)) return ctx.badRequest('invalid reason')
    const data = await (strapi.service('api::muted-topic.muted-topic') as any).mute(String(slug).trim(), {
      reason,
      note,
      userId: ctx.state.user?.id,
    })
    if (!data.muted) return ctx.notFound(data.reason ?? 'topic not found')
    return { data }
  },

  async unmute(ctx) {
    const data = await (strapi.service('api::muted-topic.muted-topic') as any).unmute(ctx.params.documentId)
    if (!data.unmuted) return ctx.notFound('muted topic not found')
    return { data }
  },

  /** Reconcile the denormalized flag across history. */
  async rescan(ctx) {
    const data = await (strapi.service('api::muted-topic.muted-topic') as any).rescan()
    return { data }
  },

  /** Topics that look like noise — a ranked suggestion, never an action. */
  async suggestions(ctx) {
    const days = Number(ctx.query.days ?? 30)
    const minMentions = Number(ctx.query.minMentions ?? 20)
    const data = await (strapi.service('api::muted-topic.muted-topic') as any).suggestions({
      days: Number.isFinite(days) ? Math.min(Math.max(days, 1), 365) : 30,
      minMentions: Number.isFinite(minMentions) ? Math.max(minMentions, 1) : 20,
    })
    return { data }
  },
}))
