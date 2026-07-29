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
