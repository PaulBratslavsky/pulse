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

  /** GET /insights/graph — conversation map. `projections` lists what's available. */
  async graph(ctx: any) {
    const svc = strapi.service('api::analysis.graph') as any
    return {
      data: await svc.build({
        projection: ctx.query.projection,
        days: ctx.query.days ? Number(ctx.query.days) : undefined,
        minWeight: ctx.query.minWeight ? Number(ctx.query.minWeight) : undefined,
        maxNodes: ctx.query.maxNodes ? Number(ctx.query.maxNodes) : undefined,
        maxEdges: ctx.query.maxEdges ? Number(ctx.query.maxEdges) : undefined,
      }),
      meta: { projections: svc.projections() },
    }
  },

  /** Feature flags the frontend renders against (AI is optional by design). */
  async config(_ctx: any) {
    return { data: { aiEnabled: (strapi.service('api::analysis.ai') as any).enabled() } }
  },
}
