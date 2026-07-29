import { factories } from '@strapi/strapi'

/**
 * Shadow-block: a muted author's mentions are stored (full audit trail) but
 * marked `quality: spam` — out of the queue AND out of every analytic. Muting
 * is retroactive; unmuting restores. Handles are matched case-insensitively.
 */
export default factories.createCoreService('api::muted-author.muted-author', ({ strapi }) => ({
  async isMuted(handle: string | null | undefined): Promise<boolean> {
    if (!handle) return false
    const hit = await strapi
      .documents('api::muted-author.muted-author')
      .findFirst({ filters: { handle: { $eqi: handle } } as any })
    return Boolean(hit)
  },

  /** Mute + retro-mark every existing mention from that author. */
  async mute(handle: string, { reason, note, userId }: { reason?: string; note?: string; userId?: number }) {
    const existing = await strapi
      .documents('api::muted-author.muted-author')
      .findFirst({ filters: { handle: { $eqi: handle } } as any })

    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { authorHandle: { $eqi: handle } } as any,
      fields: ['authorHandle'],
      limit: 1000,
    })
    for (const m of mentions as any[]) {
      await strapi.documents('api::mention.mention').update({
        documentId: m.documentId,
        data: { quality: 'spam' } as any,
      })
    }

    const data = {
      handle,
      reason: reason ?? 'ai-spam',
      note: note ?? null,
      mentionCount: mentions.length,
      ...(userId ? { mutedBy: userId } : {}),
    }
    const record: any = existing
      ? await strapi
          .documents('api::muted-author.muted-author')
          .update({ documentId: existing.documentId, data: data as any })
      : await strapi.documents('api::muted-author.muted-author').create({ data: data as any })

    strapi.log.info(`[mute] ${handle} muted (${mentions.length} mention(s) marked spam)`)
    return { handle, muted: true, mentionsMarked: mentions.length, documentId: record.documentId }
  },

  /**
   * Retroactive heuristic pass: the intake only classifies NEW mentions, so
   * history never gets scanned. Flags matches as `suspected-spam` (never
   * `spam` — a human still confirms), and re-marks anything from an
   * already-muted author. Idempotent.
   */
  async rescan() {
    const intake = strapi.plugin('octolens').service('intake') as any
    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { quality: { $ne: 'spam' } } as any,
      fields: ['content', 'authorHandle', 'quality'],
      limit: 5000,
    })
    let suspected = 0
    let muted = 0
    for (const m of mentions as any[]) {
      if (await this.isMuted(m.authorHandle)) {
        await strapi
          .documents('api::mention.mention')
          .update({ documentId: m.documentId, data: { quality: 'spam' } as any })
        muted += 1
        continue
      }
      const signals = intake.spamSignals(m.content)
      if (signals.length && m.quality !== 'suspected-spam') {
        await strapi
          .documents('api::mention.mention')
          .update({ documentId: m.documentId, data: { quality: 'suspected-spam' } as any })
        suspected += 1
      }
    }
    strapi.log.info(`[rescan] ${suspected} flagged suspected-spam, ${muted} marked spam (muted author)`)
    return { scanned: mentions.length, flaggedSuspected: suspected, markedSpam: muted }
  },

  /** Unmute + restore their mentions to `normal`. */
  async unmute(documentId: string) {
    const record: any = await strapi.documents('api::muted-author.muted-author').findOne({ documentId })
    if (!record) return { unmuted: false, reason: 'not found' }

    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { authorHandle: { $eqi: record.handle }, quality: 'spam' } as any,
      fields: ['authorHandle'],
      limit: 1000,
    })
    for (const m of mentions as any[]) {
      await strapi.documents('api::mention.mention').update({
        documentId: m.documentId,
        data: { quality: 'normal' } as any,
      })
    }
    await strapi.documents('api::muted-author.muted-author').delete({ documentId })
    return { unmuted: true, handle: record.handle, mentionsRestored: mentions.length }
  },
}))
