export default {
  /** What the Settings card renders: is AI on, which model, how much is unclassified. */
  async status(_ctx: any) {
    const ai = strapi.service('api::analysis.ai') as any
    const sweep = strapi.service('api::analysis.sweep') as any
    const budget = strapi.service('api::analysis.budget') as any
    return {
      data: {
        enabled: ai.enabled(),
        provider: process.env.AI_PROVIDER || 'anthropic',
        model: process.env.AI_MODEL || '(provider default)',
        counts: await sweep.unclassifiedCount(),
        budget: await budget.status(),
      },
    }
  },

  /** POST /analysis/reclassify — { all?: boolean }. Re-queues; the sweep does
   *  the work on its next tick, so this returns immediately rather than
   *  blocking a request on hundreds of model calls. */
  async reclassify(ctx: any) {
    const ai = strapi.service('api::analysis.ai') as any
    if (!ai.enabled()) return ctx.badRequest('AI is disabled — set AI_API_KEY to classify')
    const scope = ctx.request.body?.scope === 'fallback' ? 'fallback' : 'missing'
    return { data: await (strapi.service('api::analysis.sweep') as any).requeueUnclassified({ scope }) }
  },
}
