import { factories } from '@strapi/strapi'
import { logActivity } from '../../../utils/activity'

export default factories.createCoreController('api::response.response', ({ strapi }) => ({
  /**
   * Overridden create: respondedBy/respondedAt are server-set (never from the body),
   * parent mention moves to `answered`, and the transition is logged.
   */
  async create(ctx) {
    const user = ctx.state.user
    const { mentionDocumentId, finalText, draftText, notes, internal } =
      ctx.request.body?.data ?? ctx.request.body ?? {}
    if (!mentionDocumentId || !finalText) return ctx.badRequest('mentionDocumentId and finalText are required')

    const mention = await strapi.documents('api::mention.mention').findOne({ documentId: mentionDocumentId })
    if (!mention) return ctx.badRequest('mention not found')

    const isInternal = Boolean(internal)
    const response = await strapi.documents('api::response.response').create({
      data: {
        mention: mentionDocumentId,
        finalText,
        draftText: draftText ?? null,
        notes: notes ?? null,
        internal: isInternal,
        respondedBy: user.id,
        respondedAt: new Date().toISOString(),
      } as any,
    })
    // Internal notes record team commentary without a public reply — the mention
    // keeps its workflow status (acknowledged/claimed/etc.), only real replies answer it.
    if (!isInternal) {
      await strapi.documents('api::mention.mention').update({
        documentId: mentionDocumentId,
        // the pending draft is consumed by the recorded reply (kept as response.draftText)
        data: { status: 'answered', draftText: null, draftedAt: null, draftedVia: null } as any,
      })
    }
    await logActivity(strapi, {
      mentionDocumentId,
      action: isInternal ? 'noted' : 'answered',
      actorId: user.id,
      detail: { responseDocumentId: response.documentId, internal: isInternal },
    })
    return { data: response }
  },

  /** Record how a response landed; `resolved` closes the mention. */
  async outcome(ctx) {
    const { documentId } = ctx.params
    const user = ctx.state.user
    const { result, notes } = ctx.request.body ?? {}
    if (!['resolved', 'positive-turn', 'no-reaction', 'escalated'].includes(result))
      return ctx.badRequest('invalid outcome result')

    const response = await strapi
      .documents('api::response.response')
      .findOne({ documentId, populate: { mention: true } as any })
    if (!response) return ctx.notFound('response not found')

    const updated = await strapi.documents('api::response.response').update({
      documentId,
      data: { outcome: { result, notes: notes ?? null, recordedAt: new Date().toISOString() } } as any,
    })

    const mention = (response as any).mention
    // outcomes on internal notes must never resolve the mention — only a real
    // public reply's outcome closes the workflow (documented state machine)
    if (result === 'resolved' && mention && !(response as any).internal) {
      await strapi.documents('api::mention.mention').update({
        documentId: mention.documentId,
        data: { status: 'resolved' } as any,
      })
      await logActivity(strapi, {
        mentionDocumentId: mention.documentId,
        action: 'resolved',
        actorId: user.id,
        detail: { responseDocumentId: documentId, result },
      })
    }
    return { data: updated }
  },
}))
