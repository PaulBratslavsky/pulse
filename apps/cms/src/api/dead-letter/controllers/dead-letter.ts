import { factories } from '@strapi/strapi'

/**
 * Replay closes the dead-letter loop the schema promises ("replayable, never
 * dropped"): re-run the stored raw payload through the SAME normalize + intake
 * path that failed, and mark the letter resolved on success. Idempotent — if
 * the mention was already ingested meanwhile, intake dedupes on externalId.
 */
export default factories.createCoreController('api::dead-letter.dead-letter', ({ strapi }) => ({
  async replay(ctx) {
    const { documentId } = ctx.params
    const letter: any = await strapi.documents('api::dead-letter.dead-letter').findOne({ documentId })
    if (!letter) return ctx.notFound('dead letter not found')
    if (letter.resolved) return ctx.badRequest('dead letter already resolved')

    const intake = strapi.plugin('octolens').service('intake') as any
    let normalized
    try {
      normalized = intake.normalizePayload(letter.raw)
    } catch (err: any) {
      return ctx.badRequest(`still malformed: ${err.message}`)
    }
    const result = await intake.upsertMention(normalized, letter.raw, 'sync')
    await strapi.documents('api::dead-letter.dead-letter').update({
      documentId,
      data: { resolved: true } as any,
    })
    return { data: { replayed: true, created: result.created, mentionDocumentId: result.documentId } }
  },
}))
