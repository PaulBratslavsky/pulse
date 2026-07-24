import { factories } from '@strapi/strapi'
import { logActivity } from '../../../utils/activity'

/**
 * Workflow rules (from the build spec):
 * - Server-set fields (owner, assignee, humanCorrected, status) are NEVER read from
 *   the request body wholesale — controllers stamp them via the Document Service.
 * - Every transition writes an activity record.
 * - Mentions are never created/updated through the auto REST API.
 */
export default factories.createCoreController('api::mention.mention', ({ strapi }) => ({
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
      await strapi
        .plugin('notify')
        .service('slack')
        .pingAssignee({ mention, assignee, router: user })
        .catch((err: Error) => strapi.log.warn(`assignee ping failed: ${err.message}`))
    }
    return { data: updated }
  },

  async correct(ctx) {
    const { documentId } = ctx.params
    const user = ctx.state.user
    const { sentimentLabel, sentimentScore, topicIds } = ctx.request.body ?? {}
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
    if (Array.isArray(topicIds)) data.topics = topicIds

    const updated = await strapi.documents('api::mention.mention').update({ documentId, data: data as any })
    await logActivity(strapi, {
      mentionDocumentId: documentId,
      action: 'corrected',
      actorId: user.id,
      detail: { before, after: { sentimentLabel, sentimentScore, topicIds } },
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
    const { documentId } = ctx.params
    const mention = await strapi
      .documents('api::mention.mention')
      .findOne({ documentId, populate: { topics: true, channel: true } as any })
    if (!mention) return ctx.notFound('mention not found')

    const draft = await strapi.plugin('analysis').service('ai').draft(mention)
    return { data: { draft } }
  },
}))
