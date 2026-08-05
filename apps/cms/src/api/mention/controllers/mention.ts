import { factories } from '@strapi/strapi'
import { sendWorkflowError } from '../../../utils/workflow-error'
import { budgetSpent } from '../../../utils/ai-gate'
import { collapseThreads } from '../../../utils/collapse-threads'

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
    // Taken off the query BEFORE validation: `strictParams` rejects any key it
    // does not recognise (a 400 reading "Invalid key group"), and this one is
    // ours rather than a filter for the Document Service.
    const groupByThread = ctx.query.group === 'thread'
    if ('group' in ctx.query) delete (ctx.query as any).group

    // factory types mark these helpers optional — they exist at runtime
    await this.validateQuery!(ctx)
    const sanitizedQuery = await this.sanitizeQuery!(ctx)

    // One row per conversation. Opt-in per request rather than a mode on the
    // server, so every other caller (MCP tools, bulk triage, exports) keeps
    // seeing individual mentions, which is what they mean.
    if (groupByThread) {
      const page = Math.max(1, Number((sanitizedQuery as any).pagination?.page) || 1)
      const pageSize = Math.min(
        100,
        Math.max(1, Number((sanitizedQuery as any).pagination?.pageSize) || 25)
      )
      const collapsed = await collapseThreads(strapi, sanitizedQuery, page, pageSize)

      if (!collapsed.tooLarge) {
        const { results } = collapsed.documentIds.length
          ? await (strapi.service('api::mention.mention') as any).find({
              ...sanitizedQuery,
              filters: { documentId: { $in: collapsed.documentIds } },
              pagination: { page: 1, pageSize: collapsed.documentIds.length, withCount: false },
            })
          : { results: [] }

        // Re-imposed, because an $in query returns its own order and the whole
        // point of the first pass was to establish this one.
        const byId = new Map((results as any[]).map((m) => [m.documentId, m]))
        const ordered = collapsed.documentIds.map((id) => byId.get(id)).filter(Boolean)

        return {
          data: ordered.map((m: any) => ({
            ...shapeMention(m),
            // how many messages this row stands for; absent when it stands for
            // only itself
            threadSize: collapsed.sizes[m.documentId] ?? 1,
          })),
          meta: {
            pagination: {
              page,
              pageSize,
              total: collapsed.total,
              pageCount: Math.max(1, Math.ceil(collapsed.total / pageSize)),
            },
            grouped: true,
          },
        }
      }
      // too large to group honestly — fall through to the flat list and SAY so,
      // rather than returning a partial grouping that looks complete
      strapi.log.warn('[queue] filtered set too large to group by conversation — returning flat list')
      ctx.set('x-pulse-grouping', 'skipped')
    }

    const { results, pagination } = await (strapi
      .service('api::mention.mention') as any)
      .find(sanitizedQuery)
    return { data: (results as any[]).map(shapeMention), meta: { pagination, grouped: false } }
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
        sourceUrls: result?.sourceUrls ?? [],
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
    // Input validation BEFORE the budget check: a malformed request is a 400
    // whether or not there are tokens left, and answering it 429 would make the
    // client's bug look like ours. The gate only guards actual spending.
    const text = String(ctx.request.body?.text ?? '').trim()
    if (!text) return ctx.badRequest('text is required')
    // an editor pass over a novel is a runaway bill, not a feature
    if (text.length > 8000) return ctx.badRequest('reply is too long to refine (8000 chars max)')

    if (await budgetSpent(strapi, ctx, 'Refining resumes tomorrow — your reply is unchanged and still recordable.')) return

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
    const text = String(ctx.request.body?.text ?? '')
    const messages = ctx.request.body?.messages
    if (!Array.isArray(messages) || !messages.length) return ctx.badRequest('messages[] required')
    if (text.length > 8000) return ctx.badRequest('reply is too long (8000 chars max)')

    // Checked before spending, and after validating — see utils/ai-gate.
    if (await budgetSpent(strapi, ctx, 'Assistance resumes tomorrow — the reply box still works.')) return

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
