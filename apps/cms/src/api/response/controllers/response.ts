import { factories } from '@strapi/strapi'
import { sendWorkflowError } from '../../../utils/workflow-error'

/** Thin controllers — all workflow rules live in the response service. */
export default factories.createCoreController('api::response.response', ({ strapi }) => ({
  async create(ctx) {
    try {
      const body = ctx.request.body?.data ?? ctx.request.body ?? {}
      const data = await (strapi.service('api::response.response') as any).record(ctx.state.user, body)
      return { data }
    } catch (err) {
      return sendWorkflowError(ctx, err)
    }
  },

  /**
   * PUT /responses/:documentId — correct the record of what you posted.
   *
   * A response is a transcription of something that exists on another platform,
   * so it goes stale in ways a note never does: a typo when pasting it back, or
   * an edit made on the platform afterwards. Leaving it uncorrectable means the
   * record and the reality drift apart, and the record is what the team reads.
   *
   * `editedAt` is set and surfaced — the same contract as comments. A corrected
   * reply must never be able to pass as the original wording, because outcome
   * and sentiment were recorded against what was actually said.
   */
  async update(ctx) {
    const documentId = ctx.params.documentId ?? ctx.params.id
    const { finalText, notes } = ctx.request.body?.data ?? ctx.request.body ?? {}
    const data: Record<string, unknown> = {}

    if (finalText !== undefined) {
      if (!String(finalText).trim()) return ctx.badRequest('a recorded reply cannot be empty')
      data.finalText = String(finalText).trim()
    }
    if (notes !== undefined) data.notes = String(notes).trim() || null
    if (!Object.keys(data).length) return ctx.badRequest('nothing to update')
    data.editedAt = new Date().toISOString()

    const updated = await strapi
      .documents('api::response.response')
      .update({ documentId, data: data as any })
    return { data: updated }
  },

  /**
   * DELETE /responses/:documentId — withdraw a reply recorded by mistake.
   *
   * Soft, like comments: the row survives and every read path filters it out.
   * A recorded reply is evidence someone answered — it moved the mention to
   * 'answered' and it counts on the leaderboard — so destroying it would erase
   * the trail rather than correct it. The mention's status is deliberately left
   * alone: whether a withdrawn record means nobody replied is a judgement, and
   * re-opening a resolved mention automatically would be the wrong guess.
   */
  async delete(ctx) {
    const documentId = ctx.params.documentId ?? ctx.params.id
    await strapi
      .documents('api::response.response')
      .update({ documentId, data: { archived: true } as any })
    return { data: { documentId, archived: true } }
  },

  async outcome(ctx) {
    try {
      const { result, notes } = ctx.request.body ?? {}
      const data = await (strapi.service('api::response.response') as any).recordOutcome(
        ctx.state.user,
        ctx.params.documentId,
        { result, notes }
      )
      return { data }
    } catch (err) {
      return sendWorkflowError(ctx, err)
    }
  },
}))
