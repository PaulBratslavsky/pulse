import { factories } from '@strapi/strapi'
import { sendWorkflowError } from '../../../utils/workflow-error'

/**
 * Thin controllers: input off the ctx → workflow service (guards, transactions,
 * activity) → shaped output. All transition rules live in
 * src/api/mention/services/mention.ts — never here.
 */
/** Only these fields of a U&P user ever leave the API (relations to the user
 *  type are otherwise stripped entirely by sanitizeOutput — cookbook trap). */
const trimUser = (u: any) => (u ? { id: u.id, documentId: u.documentId, username: u.username } : null)

const shapeMention = (m: any) => ({
  ...m,
  owner: trimUser(m.owner),
  assignee: trimUser(m.assignee),
  responses: (m.responses ?? []).map((r: any) => ({ ...r, respondedBy: trimUser(r.respondedBy) })),
  activities: (m.activities ?? []).map((a: any) => ({ ...a, actor: trimUser(a.actor) })),
  // detail profile: array of comments; list profile: a relation count {count}
  comments: Array.isArray(m.comments)
    ? m.comments.map((c: any) => ({ ...c, author: trimUser(c.author) }))
    : m.comments,
  raw: undefined, // raw payload is admin-panel material, not API surface
})

export default factories.createCoreController('api::mention.mention', ({ strapi }) => ({
  /** Core find/findOne sanitize away U&P-user relations (owner/assignee/actor).
   *  Internal high-trust tool: return Document Service results with user fields
   *  explicitly whitelisted to id/username instead. */
  async find(ctx) {
    // factory types mark these helpers optional — they exist at runtime
    await this.validateQuery!(ctx)
    const sanitizedQuery = await this.sanitizeQuery!(ctx)
    const { results, pagination } = await (strapi
      .service('api::mention.mention') as any)
      .find(sanitizedQuery)
    return { data: (results as any[]).map(shapeMention), meta: { pagination } }
  },

  async findOne(ctx) {
    await this.validateQuery!(ctx)
    const sanitizedQuery = await this.sanitizeQuery!(ctx)
    // core router names the param :id; custom workflow routes use :documentId
    const documentId = ctx.params.documentId ?? ctx.params.id
    const entity = await (strapi
      .service('api::mention.mention') as any)
      .findOne(documentId, sanitizedQuery)
    if (!entity) return ctx.notFound('mention not found')
    return { data: shapeMention(entity) }
  },

  async claim(ctx) {
    try {
      const data = await (strapi.service('api::mention.mention') as any).claim(
        ctx.params.documentId,
        ctx.state.user
      )
      return { data }
    } catch (err) {
      return sendWorkflowError(ctx, err)
    }
  },

  async acknowledge(ctx) {
    try {
      const { reason, note } = ctx.request.body ?? {}
      const data = await (strapi.service('api::mention.mention') as any).acknowledge(
        ctx.params.documentId,
        ctx.state.user,
        { reason, note }
      )
      return { data }
    } catch (err) {
      return sendWorkflowError(ctx, err)
    }
  },

  async route(ctx) {
    try {
      const { suggestedTeam, assigneeId } = ctx.request.body ?? {}
      const data = await (strapi.service('api::mention.mention') as any).route(
        ctx.params.documentId,
        ctx.state.user,
        { suggestedTeam, assigneeId }
      )
      return { data }
    } catch (err) {
      return sendWorkflowError(ctx, err)
    }
  },

  async correct(ctx) {
    try {
      const { sentimentLabel, sentimentScore, topicIds, newTopics } = ctx.request.body ?? {}
      const data = await (strapi.service('api::mention.mention') as any).correct(
        ctx.params.documentId,
        ctx.state.user,
        { sentimentLabel, sentimentScore, topicIds, newTopics }
      )
      return { data }
    } catch (err) {
      return sendWorkflowError(ctx, err)
    }
  },

  async replay(ctx) {
    try {
      const data = await (strapi.service('api::mention.mention') as any).replay(
        ctx.params.documentId,
        ctx.state.user
      )
      return { data }
    } catch (err) {
      return sendWorkflowError(ctx, err)
    }
  },

  async draft(ctx) {
    if (!(strapi.service('api::analysis.ai') as any).enabled()) {
      ctx.status = 503
      ctx.body = { data: null, error: { status: 503, message: 'AI features are disabled — set AI_API_KEY on the backend to enable drafts.' } }
      return
    }
    const { documentId } = ctx.params
    const mention = await strapi
      .documents('api::mention.mention')
      .findOne({ documentId, populate: { topics: true, channel: true } as any })
    if (!mention) return ctx.notFound('mention not found')

    const draft = await (strapi.service('api::analysis.ai') as any).draft(mention)
    return { data: { draft } }
  },
}))
