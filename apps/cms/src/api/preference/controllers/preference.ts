import { factories } from '@strapi/strapi'

/** Always self-scoped: a user can read and write only their own preferences,
 *  so there is no ownership policy to get wrong. */
export default factories.createCoreController('api::preference.preference', ({ strapi }) => ({
  async mine(ctx) {
    const pref = await strapi
      .documents('api::preference.preference')
      .findFirst({ filters: { user: { id: ctx.state.user.id } } as any })
    return { data: { hideFromLeaderboard: Boolean(pref?.hideFromLeaderboard) } }
  },

  async updateMine(ctx) {
    const { hideFromLeaderboard } = ctx.request.body ?? {}
    if (typeof hideFromLeaderboard !== 'boolean') return ctx.badRequest('hideFromLeaderboard must be a boolean')

    const existing = await strapi
      .documents('api::preference.preference')
      .findFirst({ filters: { user: { id: ctx.state.user.id } } as any })
    const saved = existing
      ? await strapi
          .documents('api::preference.preference')
          .update({ documentId: existing.documentId, data: { hideFromLeaderboard } as any })
      : await strapi
          .documents('api::preference.preference')
          .create({ data: { user: ctx.state.user.id, hideFromLeaderboard } as any })
    return { data: { hideFromLeaderboard: Boolean((saved as any).hideFromLeaderboard) } }
  },
}))
