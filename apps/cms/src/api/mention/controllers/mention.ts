import { factories } from '@strapi/strapi'
import { sendWorkflowError } from '../../../utils/workflow-error'
import { budgetSpent } from '../../../utils/ai-gate'

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

  /**
   * GET /mentions/:documentId/thread — the rest of this conversation.
   *
   * Octolens ingests every comment in a thread as its own mention, so an
   * exchange arrives as six unrelated queue rows and nothing says they belong
   * together — which is how a follow-up addressed to us goes unanswered while
   * sitting in the queue the whole time. The key is derived from the permalink
   * (utils/identity.threadKeyOf); nothing is fetched from the platform.
   *
   * Returns the siblings in posting order with `isOurs` resolved from the team
   * handle allowlist, so the caller can say "they replied after you" without
   * re-deriving who we are.
   */
  async thread(ctx) {
    const mention: any = await strapi
      .documents('api::mention.mention')
      .findOne({ documentId: ctx.params.documentId })
    if (!mention) return ctx.notFound('mention not found')
    if (!mention.threadKey) return { data: { threadKey: null, mentions: [] } }

    const siblings = await strapi.documents('api::mention.mention').findMany({
      filters: { threadKey: mention.threadKey } as any,
      fields: ['content', 'authorHandle', 'postedAt', 'url', 'status', 'lane'] as any,
      sort: 'postedAt:asc' as any,
      limit: 100,
    })

    const team = strapi.service('api::team-handle.team-handle') as any
    const shaped = await Promise.all(
      (siblings as any[]).map(async (m) => ({
        documentId: m.documentId,
        content: m.content,
        authorHandle: m.authorHandle,
        postedAt: m.postedAt,
        url: m.url,
        status: m.status,
        lane: m.lane,
        isSelf: m.documentId === mention.documentId,
        isOurs: await team.isOurs(m.authorHandle),
      }))
    )
    return { data: { threadKey: mention.threadKey, mentions: shaped } }
  },

  async correct(ctx) {
    try {
      const { sentimentLabel, sentimentScore, topicIds, newTopics, lane } = ctx.request.body ?? {}
      const data = await (strapi.service('api::mention.mention') as any).correct(
        ctx.params.documentId,
        ctx.state.user,
        { sentimentLabel, sentimentScore, topicIds, newTopics, lane }
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

  /** POST /mentions/:documentId/quality — { quality, reason? } */
  async quality(ctx) {
    try {
      const data = await (strapi.service('api::mention.mention') as any).setQuality(
        ctx.params.documentId,
        ctx.state.user,
        ctx.request.body?.quality,
        ctx.request.body?.reason,
        'app'
      )
      return { data }
    } catch (err) {
      return sendWorkflowError(ctx, err)
    }
  },

  /** POST /mentions/bulk — { action, documentIds[], ...payload } */
  async bulk(ctx) {
    try {
      const { action, documentIds, ...payload } = ctx.request.body ?? {}
      if (!['acknowledge', 'claim', 'correct'].includes(action))
        return ctx.badRequest('action must be acknowledge | claim | correct')
      const data = await (strapi.service('api::mention.mention') as any).bulk(
        action,
        documentIds,
        ctx.state.user,
        payload
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
    if (await budgetSpent(strapi, ctx, 'Drafting resumes tomorrow — you can still write and record a reply.')) return

    const { documentId } = ctx.params
    const mention = await strapi
      .documents('api::mention.mention')
      .findOne({ documentId, populate: { topics: true, channel: true } as any })
    if (!mention) return ctx.notFound('mention not found')

    const result = await (strapi.service('api::analysis.ai') as any).draft(mention)
    // `draft` stays a plain string for existing callers; the provenance rides
    // alongside so the UI can say whether the docs server was actually in play.
    return {
      data: {
        draft: result?.text ?? null,
        grounded: Boolean(result?.grounded),
        sources: result?.sources ?? 0,
      },
    }
  },

  /** POST /mentions/:documentId/refine — { text }. Improves a reply the human wrote. */
  async refine(ctx) {
    if (!(strapi.service('api::analysis.ai') as any).enabled()) {
      ctx.status = 503
      ctx.body = { data: null, error: { status: 503, message: 'AI features are disabled — set AI_API_KEY on the backend to enable this.' } }
      return
    }
    if (await budgetSpent(strapi, ctx, 'Refining resumes tomorrow — your reply is unchanged and still recordable.')) return

    const text = String(ctx.request.body?.text ?? '').trim()
    if (!text) return ctx.badRequest('text is required')
    // an editor pass over a novel is a runaway bill, not a feature
    if (text.length > 8000) return ctx.badRequest('reply is too long to refine (8000 chars max)')

    const mention = await strapi
      .documents('api::mention.mention')
      .findOne({ documentId: ctx.params.documentId, populate: { channel: true } as any })
    if (!mention) return ctx.notFound('mention not found')

    const refined = await (strapi.service('api::analysis.ai') as any).refine(mention, text)
    return { data: { refined: refined?.text ?? null, grounded: Boolean(refined?.grounded) } }
  },

  /**
   * POST /mentions/:documentId/draft-chat — { text, messages }.
   * Talk about the reply you are writing, with the docs server in the room.
   * Returns a prose answer and, only when one was asked for, a proposed
   * revision the human applies themselves.
   */
  async draftChat(ctx) {
    if (!(strapi.service('api::analysis.ai') as any).enabled()) {
      ctx.status = 503
      ctx.body = { data: null, error: { status: 503, message: 'AI features are disabled — set AI_API_KEY on the backend to enable this.' } }
      return
    }
    // Checked BEFORE spending, not after — see utils/ai-gate.
    if (await budgetSpent(strapi, ctx, 'Assistance resumes tomorrow — the reply box still works.')) return

    const text = String(ctx.request.body?.text ?? '')
    const messages = ctx.request.body?.messages
    if (!Array.isArray(messages) || !messages.length) return ctx.badRequest('messages[] required')
    if (text.length > 8000) return ctx.badRequest('reply is too long (8000 chars max)')

    const mention = await strapi
      .documents('api::mention.mention')
      .findOne({ documentId: ctx.params.documentId, populate: { channel: true } as any })
    if (!mention) return ctx.notFound('mention not found')

    const result = await (strapi.service('api::analysis.ai') as any).chatRefine(mention, text, messages)
    return {
      data: {
        reply: result?.reply ?? null,
        revision: result?.revision ?? null,
        grounded: Boolean(result?.grounded),
        sources: result?.sources ?? 0,
      },
    }
  },
}))
