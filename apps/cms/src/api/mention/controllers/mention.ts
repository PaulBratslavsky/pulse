import { factories } from '@strapi/strapi'
import { logActivity } from '../../../utils/activity'

/**
 * Workflow rules (from the build spec):
 * - Server-set fields (owner, assignee, humanCorrected, status) are NEVER read from
 *   the request body wholesale — controllers stamp them via the Document Service.
 * - Every transition writes an activity record.
 * - Mentions are never created/updated through the auto REST API.
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
    const { documentId } = ctx.params
    const user = ctx.state.user
    const mention = await strapi.documents('api::mention.mention').findOne({ documentId })
    if (!mention) return ctx.notFound('mention not found')

    const updated = await strapi.documents('api::mention.mention').update({
      documentId,
      data: { owner: user.id, status: 'claimed' } as any,
    })
    await logActivity(strapi, {
      mentionDocumentId: documentId,
      action: 'claimed',
      actorId: user.id,
      detail: { from: mention.status, to: 'claimed' },
    })
    return { data: updated }
  },

  async route(ctx) {
    const { documentId } = ctx.params
    const user = ctx.state.user
    const { suggestedTeam, assigneeId } = ctx.request.body ?? {}
    const mention = await strapi.documents('api::mention.mention').findOne({ documentId })
    if (!mention) return ctx.notFound('mention not found')

    const data: Record<string, unknown> = {}
    if (suggestedTeam) {
      if (!['devrel', 'marketing', 'product'].includes(suggestedTeam))
        return ctx.badRequest('invalid suggestedTeam')
      data.suggestedTeam = suggestedTeam
    }
    let assignee: any = null
    if (assigneeId) {
      assignee = await strapi
        .query('plugin::users-permissions.user')
        .findOne({ where: { id: assigneeId } })
      if (!assignee) return ctx.badRequest('assignee not found')
      data.assignee = assignee.id
    }
    if (!Object.keys(data).length) return ctx.badRequest('nothing to route')

    const updated = await strapi.documents('api::mention.mention').update({ documentId, data: data as any })
    await logActivity(strapi, {
      mentionDocumentId: documentId,
      action: 'routed',
      actorId: user.id,
      detail: { suggestedTeam: suggestedTeam ?? null, assignee: assignee?.username ?? null },
    })
    if (assignee) {
      await (strapi.service('api::notify.slack') as any)
        .pingAssignee({ mention, assignee, router: user })
        .catch((err: Error) => strapi.log.warn(`assignee ping failed: ${err.message}`))
    }
    return { data: updated }
  },

  /** Close a mention deliberately without a public reply (competitor threads,
   *  not-relevant chatter, watch-list items). Keeps full analytics value —
   *  trends/themes key off analysisStatus, not workflow status. */
  async acknowledge(ctx) {
    const { documentId } = ctx.params
    const user = ctx.state.user
    const { reason, note } = ctx.request.body ?? {}
    if (!['competitor', 'not-relevant', 'watching'].includes(reason))
      return ctx.badRequest('invalid reason')
    const mention = await strapi.documents('api::mention.mention').findOne({ documentId })
    if (!mention) return ctx.notFound('mention not found')

    const updated = await strapi.documents('api::mention.mention').update({
      documentId,
      data: { status: 'acknowledged', acknowledgeReason: reason } as any,
    })
    await logActivity(strapi, {
      mentionDocumentId: documentId,
      action: 'acknowledged',
      actorId: user.id,
      detail: { from: mention.status, reason, note: note || null },
    })
    return { data: updated }
  },

  async correct(ctx) {
    const { documentId } = ctx.params
    const user = ctx.state.user
    const { sentimentLabel, sentimentScore, topicIds, newTopics } = ctx.request.body ?? {}
    const mention = await strapi
      .documents('api::mention.mention')
      .findOne({ documentId, populate: { topics: true } as any })
    if (!mention) return ctx.notFound('mention not found')

    const before = {
      sentimentLabel: mention.sentimentLabel,
      sentimentScore: mention.sentimentScore,
      topics: ((mention as any).topics ?? []).map((t: any) => t.name),
    }
    const data: Record<string, unknown> = { humanCorrected: true }
    if (sentimentLabel) {
      if (!['positive', 'neutral', 'negative'].includes(sentimentLabel))
        return ctx.badRequest('invalid sentimentLabel')
      data.sentimentLabel = sentimentLabel
    }
    if (typeof sentimentScore === 'number') {
      if (sentimentScore < -1 || sentimentScore > 1) return ctx.badRequest('score out of range')
      data.sentimentScore = sentimentScore
    }
    // Team can mint topics inline (keyless mode has no auto-clustering); topic.create
    // stays unexposed — creation only happens through this validated path.
    const createdTopicIds: string[] = []
    if (Array.isArray(newTopics)) {
      for (const rawName of newTopics.slice(0, 10)) {
        const name = String(rawName).trim().slice(0, 80)
        if (!name) continue
        const existing = await strapi
          .documents('api::topic.topic')
          .findFirst({ filters: { name: { $eqi: name } } })
        const topic =
          existing ??
          (await strapi.documents('api::topic.topic').create({ data: { name, kind: 'other' } as any }))
        createdTopicIds.push(topic.documentId)
      }
    }
    if (Array.isArray(topicIds) || createdTopicIds.length)
      data.topics = [...new Set([...(Array.isArray(topicIds) ? topicIds : []), ...createdTopicIds])]

    const updated = await strapi.documents('api::mention.mention').update({ documentId, data: data as any })
    await logActivity(strapi, {
      mentionDocumentId: documentId,
      action: 'corrected',
      actorId: user.id,
      detail: { before, after: { sentimentLabel, sentimentScore, topicIds, newTopics: newTopics ?? null } },
    })
    return { data: updated }
  },

  async replay(ctx) {
    const { documentId } = ctx.params
    const user = ctx.state.user
    const mention = await strapi.documents('api::mention.mention').findOne({ documentId })
    if (!mention) return ctx.notFound('mention not found')
    if (!mention.raw) return ctx.badRequest('mention has no raw payload to replay')

    await strapi.documents('api::mention.mention').update({
      documentId,
      data: { analysisStatus: 'pending' } as any,
    })
    await logActivity(strapi, {
      mentionDocumentId: documentId,
      action: 'replayed',
      actorId: user.id,
      detail: { note: 'analysisStatus reset to pending; cron sweep will re-analyze (humanCorrected fields preserved)' },
    })
    return { data: { queued: true } }
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
