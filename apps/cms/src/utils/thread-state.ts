import type { Core } from '@strapi/strapi'

/**
 * Which conversations are waiting on us.
 *
 * A mention is `awaitsReply` when it is the LAST message in its thread that is
 * not ours, and we have already spoken in that thread. In other words: someone
 * answered us and nobody has answered them.
 *
 * That is the case the queue could not see. A follow-up arrives as an ordinary
 * mention among hundreds, indistinguishable from a stranger's first post — so a
 * Reddit reply addressed to us sat unanswered for three days while the response
 * was eventually written by hand on the platform.
 *
 * Only the last one is marked. A thread where three people replied after us is
 * one conversation to answer, not three queue rows; marking each would turn a
 * busy thread into a false backlog.
 *
 * **Reddit only, and not by choice.** A mention is only eligible for this if it
 * carries a threadKey, and threadKeyOf (utils/identity) can only derive one from
 * a Reddit permalink — it names the subreddit and the post. An X or LinkedIn URL
 * is just /status/<id>: nothing in it says which conversation the post belongs
 * to, and the Octolens payload carries no conversation or parent id either (I
 * checked a real X mention in prod: id, url, body, author, keywords, sentiment,
 * followers — no parent). So this is not a regex that could be widened; without
 * the platform APIs the data does not exist. Anything user-facing that depends
 * on awaitsReply must say which platforms it can actually see, or an empty
 * result reads as "nobody is waiting" when it means "I cannot tell".
 *
 * "We have spoken" means the later of two things, because they have different
 * lag: a mention from one of our own handles (ground truth, but Octolens takes
 * time to ingest it) and a response recorded in Pulse (immediate, and the thing
 * a human just did). Using only the former would nag you about a thread you
 * answered thirty seconds ago.
 */
export async function refreshThread(strapi: Core.Strapi, threadKey: string): Promise<number> {
  if (!threadKey) return 0

  const mentions: any[] = await strapi.documents('api::mention.mention').findMany({
    filters: { threadKey } as any,
    fields: ['authorHandle', 'postedAt', 'awaitsReply'] as any,
    populate: { responses: { fields: ['respondedAt'] } } as any,
    sort: 'postedAt:asc' as any,
    limit: 200,
  })
  if (mentions.length < 2) {
    // A thread of one cannot be waiting on us — clear any stale flag and stop.
    return clearAll(strapi, mentions)
  }

  const team = strapi.service('api::team-handle.team-handle') as any
  const ours = await Promise.all(mentions.map((m) => team.isOurs(m.authorHandle)))

  const at = (m: any) => new Date(m.postedAt ?? 0).getTime()
  let spokeAt = 0
  for (const [i, m] of mentions.entries()) {
    if (ours[i]) spokeAt = Math.max(spokeAt, at(m))
    for (const r of m.responses ?? []) {
      // a reply recorded here counts immediately, before Octolens re-ingests it
      if (r?.respondedAt) spokeAt = Math.max(spokeAt, new Date(r.respondedAt).getTime())
    }
  }
  if (!spokeAt) return clearAll(strapi, mentions)

  const after = mentions.filter((m, i) => !ours[i] && at(m) > spokeAt)
  const waiting = after.length ? after[after.length - 1].documentId : null

  let changed = 0
  for (const m of mentions) {
    const next = m.documentId === waiting
    if (Boolean(m.awaitsReply) === next) continue
    await strapi
      .documents('api::mention.mention')
      .update({ documentId: m.documentId, data: { awaitsReply: next } as any })
    changed++
  }
  return changed
}

async function clearAll(strapi: Core.Strapi, mentions: any[]): Promise<number> {
  let changed = 0
  for (const m of mentions) {
    if (!m.awaitsReply) continue
    await strapi
      .documents('api::mention.mention')
      .update({ documentId: m.documentId, data: { awaitsReply: false } as any })
    changed++
  }
  return changed
}

/**
 * Recompute every threaded conversation (bootstrap, idempotent).
 *
 * Cheap: it reads mentions that already carry a threadKey and writes only where
 * the answer changed, so a steady state costs one query per thread and no
 * writes.
 */
export async function refreshAllThreads(strapi: Core.Strapi): Promise<number> {
  const rows: any[] = await strapi.documents('api::mention.mention').findMany({
    filters: { threadKey: { $notNull: true } } as any,
    fields: ['threadKey'] as any,
    limit: 20000,
  })
  const keys = [...new Set(rows.map((r) => r.threadKey).filter(Boolean))]

  let changed = 0
  for (const key of keys) changed += await refreshThread(strapi, key)
  if (changed) strapi.log.info(`pulse: ${changed} mention(s) changed awaiting-reply state`)
  return changed
}
