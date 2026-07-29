import { factories } from '@strapi/strapi'
import { logActivity } from '../../../utils/activity'
import { WorkflowError } from '../../../utils/workflow-error'

const OUTCOMES = ['resolved', 'positive-turn', 'no-reaction', 'escalated']

/** Response workflow: record (a posted public reply, or an internal note) and
 *  outcome. Same rules as the mention service: guard → transactional writes →
 *  atomic activity. A recorded PUBLIC reply consumes the pending draft and
 *  moves the mention to 'answered' from ANY status (a real reply always
 *  counts — it re-opens acknowledged/resolved). Internal notes touch nothing. */
export default factories.createCoreService('api::response.response', ({ strapi }) => ({
  async record(user: { id: number }, { mentionDocumentId, finalText, draftText, notes, internal }: any) {
    if (!mentionDocumentId || !String(finalText ?? '').trim())
      throw new WorkflowError(400, 'mentionDocumentId and finalText are required')
    const mention = await strapi.documents('api::mention.mention').findOne({ documentId: mentionDocumentId })
    if (!mention) throw new WorkflowError(400, 'mention not found')

    const isInternal = Boolean(internal)
    return strapi.db.transaction(async () => {
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
      return response
    })
  },

  async recordOutcome(user: { id: number }, documentId: string, { result, notes }: any) {
    if (!OUTCOMES.includes(result)) throw new WorkflowError(400, 'invalid outcome result')
    const response: any = await strapi
      .documents('api::response.response')
      .findOne({ documentId, populate: { mention: true } as any })
    if (!response) throw new WorkflowError(404, 'response not found')

    const mention = response.mention
    // outcomes on internal notes never resolve the mention — only a public
    // reply's outcome closes the workflow; and only from 'answered'
    const resolves = result === 'resolved' && mention && !response.internal
    if (resolves && mention.status !== 'answered')
      throw new WorkflowError(409, `cannot resolve a '${mention.status}' mention — record the reply first`)

    return strapi.db.transaction(async () => {
      const updated = await strapi.documents('api::response.response').update({
        documentId,
        data: { outcome: { result, notes: notes ?? null, recordedAt: new Date().toISOString() } } as any,
      })
      if (resolves) {
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
      return updated
    })
  },
}))
