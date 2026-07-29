/**
 * Thin wrappers — the Pulse score / themes / stale logic lives in ONE place:
 * (strapi.service('api::analysis.insights') as any) (also consumed by the MCP
 * tools, the assistant, and the Slack stale digest).
 */
export default {
  async trends(ctx: any) {
    const { from, to, topic } = ctx.query
    return { data: await (strapi.service('api::analysis.insights') as any).trends({ from, to, topic }) }
  },

  async themes(ctx: any) {
    const days = ctx.query.window ? Number(ctx.query.window) : undefined
    return { data: await (strapi.service('api::analysis.insights') as any).themes({ days }) }
  },

  async stale(ctx: any) {
    const days = ctx.query.days ? Number(ctx.query.days) : undefined
    return { data: await (strapi.service('api::analysis.insights') as any).stale({ days }) }
  },

  async feedback(ctx: any) {
    const days = ctx.query.days ? Number(ctx.query.days) : undefined
    return { data: await (strapi.service('api::analysis.insights') as any).feedback({ days, topic: ctx.query.topic }) }
  },

  async leaderboard(ctx: any) {
    const days = ctx.query.days ? Number(ctx.query.days) : undefined
    return { data: await (strapi.service('api::analysis.insights') as any).leaderboard({ days }) }
  },

  async snapshot(ctx: any) {
    const days = ctx.query.days ? Number(ctx.query.days) : undefined
    return { data: await (strapi.service('api::analysis.insights') as any).snapshot({ days }) }
  },

  /** Feature flags the frontend renders against (AI is optional by design). */
  async config(_ctx: any) {
    return { data: { aiEnabled: (strapi.service('api::analysis.ai') as any).enabled() } }
  },
}
