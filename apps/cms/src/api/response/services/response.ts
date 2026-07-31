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
        // Auto-claim: replying IS taking the mention. Forgetting to press Claim
        // first shouldn't leave it ownerless — but never take it from someone
        // else, so only an unowned mention is adopted.
        const current: any = await strapi
          .documents('api::mention.mention')
          .findOne({ documentId: mentionDocumentId, populate: { owner: { fields: ['id'] } } as any })
        const adopt = !current?.owner

        await strapi.documents('api::mention.mention').update({
          documentId: mentionDocumentId,
          // the pending draft is consumed by the recorded reply (kept as response.draftText)
          data: {
            status: 'answered',
            draftText: null,
            draftedAt: null,
            draftedVia: null,
            ...(adopt ? { owner: user.id } : {}),
          } as any,
        })
        if (adopt)
          await logActivity(strapi, {
            mentionDocumentId,
            action: 'claimed',
            actorId: user.id,
            detail: { auto: true, via: 'recorded a reply' },
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
      .findOne({ documentId, populate: { mention: true, outcome: true } as any })
    if (!response) throw new WorkflowError(404, 'response not found')

    if (response.outcome?.result)
      throw new WorkflowError(409, `outcome already recorded ('${response.outcome.result}')`)

    const mention = response.mention
    // outcomes on internal notes never resolve the mention — only a public
    // reply's outcome closes the workflow; and only from 'answered'
    const resolves = result === 'resolved' && mention && !response.internal

    return strapi.db.transaction(async ({ trx }: any) => {
      if (resolves) {
        // race-proof: re-check the mention's status under a row lock
        const row = await trx('mentions').where({ document_id: mention.documentId }).forUpdate().first()
        if (!row || row.status !== 'answered')
          throw new WorkflowError(409, `cannot resolve a '${row?.status ?? 'missing'}' mention — record the reply first`)
      }
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
