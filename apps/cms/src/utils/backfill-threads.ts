import type { Core } from '@strapi/strapi'
import { threadKeyOf } from './identity'

/**
 * Derive `threadKey` for mentions that predate the column (bootstrap, idempotent).
 *
 * Every mention already carries the permalink that identifies its conversation,
 * so nothing is fetched — this only reads what is there and writes the key.
 * Runs on every boot rather than once because the derivation may improve
 * (another platform's URL shape) and re-deriving is free.
 *
 * Only touches rows whose key is missing or has changed, so a steady state
 * costs one query.
 */
export async function backfillThreadKeys(strapi: Core.Strapi) {
  const rows: any[] = await strapi.documents('api::mention.mention').findMany({
    filters: { url: { $notNull: true } } as any,
    fields: ['url', 'threadKey'] as any,
    limit: 20000,
  })

  let updated = 0
  for (const m of rows) {
    const key = threadKeyOf(m.url)
    if (!key || key === m.threadKey) continue
    await strapi
      .documents('api::mention.mention')
      .update({ documentId: m.documentId, data: { threadKey: key } as any })
    updated++
  }

  if (updated) strapi.log.info(`pulse: derived a conversation for ${updated} mention(s)`)
  return updated
}
