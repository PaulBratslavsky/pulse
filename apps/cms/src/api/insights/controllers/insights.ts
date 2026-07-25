/**
 * Thin wrappers — the Pulse score / themes / stale logic lives in ONE place:
 * strapi.plugin('analysis').service('insights') (also consumed by the MCP
 * tools, the assistant, and the Slack stale digest).
 */
export default {
  async trends(ctx: any) {
    const { from, to, topic } = ctx.query
    return { data: await strapi.plugin('analysis').service('insights').trends({ from, to, topic }) }
  },

  async themes(ctx: any) {
    const days = ctx.query.window ? Number(ctx.query.window) : undefined
    return { data: await strapi.plugin('analysis').service('insights').themes({ days }) }
  },

  async stale(ctx: any) {
    const days = ctx.query.days ? Number(ctx.query.days) : undefined
    return { data: await strapi.plugin('analysis').service('insights').stale({ days }) }
  },

  /** Feature flags the frontend renders against (AI is optional by design). */
  async config(_ctx: any) {
    return { data: { aiEnabled: strapi.plugin('analysis').service('ai').enabled() } }
  },
}
