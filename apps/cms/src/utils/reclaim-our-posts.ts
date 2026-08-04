import type { Core } from '@strapi/strapi'

/**
 * Put right the posts of ours that were flagged before the allowlist existed
 * (bootstrap, idempotent).
 *
 * The spam heuristic reads promotional language, and a teammate recommending
 * Strapi IS promotional language — one of our own Reddit comments suggesting
 * Next.js + Strapi sat at `suspected-spam`. Adding a handle to the allowlist
 * fixes every future mention, and would leave that one flagged forever.
 *
 * Runs on every boot rather than once, because the allowlist keeps growing:
 * adding a teammate months from now should also clear whatever of theirs was
 * mislabelled in the meantime. Cheap — it only touches rows that are wrong.
 *
 * Deliberately narrow. It clears `suspected-spam`, which is a machine's guess,
 * and never `spam`, which is a human's decision — if someone deliberately
 * confirmed one of our own posts as spam they had a reason, and boot code is
 * not the place to overrule them.
 */
export async function reclaimOurPosts(strapi: Core.Strapi) {
  const handles = await (strapi.service('api::team-handle.team-handle') as any).handles()
  if (!handles.size) return 0

  const rows = await strapi.documents('api::mention.mention').findMany({
    filters: {
      authorHandle: { $in: [...handles] },
      $or: [{ quality: 'suspected-spam' }, { acknowledgeReason: { $null: true } }],
    } as any,
    fields: ['authorHandle', 'quality', 'status', 'acknowledgeReason'] as any,
    limit: 2000,
  })

  let fixed = 0
  for (const m of rows as any[]) {
    // findMany's $in is case-sensitive on some connectors; the allowlist is
    // stored lowercased, so confirm rather than trust the filter.
    if (!handles.has(String(m.authorHandle ?? '').trim().replace(/^@+/, '').toLowerCase())) continue

    const data: Record<string, unknown> = {}
    if (m.quality === 'suspected-spam') {
      data.quality = 'normal'
      data.qualityReason = null
      data.qualityVia = 'team-handle allowlist'
    }
    // Nobody replies to their own post. `own-post` is the reason the product
    // already uses for this, and it keeps the mention out of sentiment metrics
    // while leaving it searchable.
    if (!m.acknowledgeReason && m.status !== 'answered' && m.status !== 'resolved') {
      data.status = 'acknowledged'
      data.acknowledgeReason = 'own-post'
    }
    if (!Object.keys(data).length) continue

    await strapi.documents('api::mention.mention').update({ documentId: m.documentId, data: data as any })
    fixed++
  }

  if (fixed) strapi.log.info(`pulse: reclaimed ${fixed} of our own post(s) from spam/queue`)
  return fixed
}
