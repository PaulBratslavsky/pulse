import type { Core } from '@strapi/strapi'
import { classify, extractKeywords, strongestTag } from './lane'

/**
 * Duplicate-mention repair + prevention (bootstrap, idempotent).
 *
 * Why duplicates existed: Strapi v5's `unique: true` is enforced by the
 * content-API validation layer — Document Service writes (our ingest path)
 * bypass it, and NO database index is generated. The intake's
 * findFirst→create pre-check is racy under concurrent syncs (cron + manual).
 *
 * Fix: (1) merge existing duplicates — keep the row with workflow value
 * (responses/comments/owner/status), delete the spares; (2) create a REAL
 * unique index so a lost race throws instead of inserting (intake catches it).
 */
export async function dedupeMentionsAndEnforceUnique(strapi: Core.Strapi) {
  const knex = strapi.db.connection

  const dupes: Array<{ external_id: string }> = await knex('mentions')
    .select('external_id')
    .whereNotNull('external_id')
    .groupBy('external_id')
    .havingRaw('count(*) > 1')

  for (const { external_id } of dupes) {
    const rows: any[] = await strapi.documents('api::mention.mention').findMany({
      filters: { externalId: external_id },
      populate: { responses: true, comments: true, activities: true, owner: true, assignee: true } as any,
      sort: 'createdAt:asc' as any,
    })
    if (rows.length < 2) continue
    const score = (m: any) =>
      (m.responses?.length ?? 0) * 10 +
      (m.comments?.length ?? 0) * 10 +
      (m.owner ? 5 : 0) +
      (m.assignee ? 4 : 0) +
      (m.status !== 'unanswered' ? 3 : 0)
    // highest workflow value wins; tie → oldest row
    const keep = [...rows].sort((a, b) => score(b) - score(a))[0]
    for (const row of rows) {
      if (row.documentId === keep.documentId) continue
      // MERGE, not just delete: re-parent the spare's children to the keeper
      // (deleting a mention drops the relation link rows — orphaning the very
      // response trail this tool exists to preserve), and carry over workflow
      // fields the keeper lacks.
      for (const r of row.responses ?? []) {
        await strapi
          .documents('api::response.response')
          .update({ documentId: r.documentId, data: { mention: keep.documentId } as any })
      }
      for (const c of row.comments ?? []) {
        await strapi
          .documents('api::comment.comment')
          .update({ documentId: c.documentId, data: { mention: keep.documentId } as any })
      }
      for (const a of row.activities ?? []) {
        await strapi
          .documents('api::activity.activity')
          .update({ documentId: a.documentId, data: { mention: keep.documentId } as any })
      }
      const carry: Record<string, unknown> = {}
      if (!keep.owner && row.owner) carry.owner = row.owner.id
      if (!keep.assignee && row.assignee) carry.assignee = row.assignee.id
      if (keep.status === 'unanswered' && row.status !== 'unanswered') carry.status = row.status
      if (Object.keys(carry).length) {
        await strapi.documents('api::mention.mention').update({ documentId: keep.documentId, data: carry as any })
        // keep the in-memory keeper current so a third+ spare can't re-carry
        if (carry.owner) keep.owner = row.owner
        if (carry.assignee) keep.assignee = row.assignee
        if (carry.status) keep.status = row.status
      }
      await strapi.documents('api::mention.mention').delete({ documentId: row.documentId })
      strapi.log.warn(
        `pulse: merged duplicate mention ${row.documentId} into ${keep.documentId} (externalId ${external_id}; moved ${row.responses?.length ?? 0} response(s), ${row.comments?.length ?? 0} comment(s), ${row.activities?.length ?? 0} activit(ies))`
      )
    }
  }

  // Backfill enum defaults on pre-existing rows: a schema `default` applies to
  // NEW inserts only, and SQL `col != 'x'` is NULL-safe-FALSE — so a filter like
  // quality != 'spam' silently hides every legacy row. Backfill, don't rely on it.
  const backfilled = await knex('mentions').whereNull('quality').update({ quality: 'normal' })
  if (backfilled) strapi.log.info(`pulse: backfilled quality='normal' on ${backfilled} mention(s)`)

  // Close spam that is still sitting in an open state. Muting used to set
  // quality only, so a retroactive mute left the author's posts 'unanswered'
  // forever: counted as outstanding work and surfacing under "Needs attention".
  // Mute and ingest both close them now; this repairs the ones muted earlier.
  const closed = await knex('mentions')
    .where({ quality: 'spam' })
    .whereIn('status', ['unanswered', 'claimed'])
    .update({ status: 'acknowledged', acknowledge_reason: 'spam' })
  if (closed) strapi.log.info(`pulse: closed ${closed} muted-author mention(s) left open by an earlier mute`)

  // Backfill routing on rows ingested before lanes existed. Without this the
  // queue keeps showing every competitor thread until each one is re-ingested,
  // which never happens. Runs only on rows with no lane yet, so it is a
  // one-time pass and a human's later correction is never overwritten.
  const unrouted: any[] = await knex('mentions').whereNull('lane').select('id', 'content', 'raw')
  if (unrouted.length) {
    let routed = 0
    for (const row of unrouted) {
      let raw: any = {}
      try {
        raw = typeof row.raw === 'string' ? JSON.parse(row.raw) : (row.raw ?? {})
      } catch {}
      const keywords = extractKeywords(raw)
      const { lane, laneReason } = classify({ content: row.content, keywords })
      await knex('mentions')
        .where({ id: row.id })
        .update({
          lane,
          lane_reason: laneReason,
          matched_keywords: JSON.stringify(keywords),
          keyword_tag: strongestTag(keywords),
        })
      routed++
    }
    strapi.log.info(`pulse: routed ${routed} pre-existing mention(s) into lanes`)
  }

  // Backfill the author + relevance fields that were being discarded into
  // `raw` on every ingest. Unlike laneEvidence (which was never stored and is
  // unrecoverable), all of this is still there — so the existing corpus can be
  // enriched without a single API call or re-sweep.
  const unenriched: any[] = await knex('mentions')
    .whereNull('author_profile_url')
    .whereNotNull('raw')
    .select('id', 'raw')
  if (unenriched.length) {
    let filled = 0
    for (const row of unenriched) {
      let raw: any = {}
      try {
        raw = typeof row.raw === 'string' ? JSON.parse(row.raw) : (row.raw ?? {})
      } catch {
        continue
      }
      const patch: Record<string, unknown> = {}
      if (raw.authorName) patch.author_name = String(raw.authorName).slice(0, 255)
      if (raw.authorUrl) patch.author_profile_url = String(raw.authorUrl).slice(0, 255)
      if (raw.authorAvatar) patch.author_avatar_url = String(raw.authorAvatar).slice(0, 255)
      if (typeof raw.authorFollowers === 'number') patch.author_followers = raw.authorFollowers
      if (typeof raw.relevanceScore === 'number') patch.relevance_score = raw.relevanceScore
      if (raw.relevanceComment) patch.relevance_comment = String(raw.relevanceComment)
      if (!Object.keys(patch).length) continue
      await knex('mentions').where({ id: row.id }).update(patch)
      filled++
    }
    if (filled) strapi.log.info(`pulse: backfilled author/relevance fields on ${filled} mention(s) from stored raw`)
  }

  // real DB-level guard (works on SQLite and Postgres; NULLs unaffected)
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS mentions_external_id_uq ON mentions (external_id)')

  // Same v5 gotcha for the other schema-unique fields (Document Service writes
  // bypass content-API unique validation), plus hot-filter indexes for the
  // queue/stale/sweep/search access paths — cheap now, painful to miss at 100k
  // rows on Postgres. Each guarded individually: one failure (e.g. pre-existing
  // case-variant topic dupes blocking the unique index) must not sink the rest.
  const INDEXES = [
    'CREATE UNIQUE INDEX IF NOT EXISTS channels_key_uq ON channels (key)',
    'CREATE UNIQUE INDEX IF NOT EXISTS topics_slug_uq ON topics (slug)',
    'CREATE INDEX IF NOT EXISTS mentions_status_posted_at_idx ON mentions (status, posted_at)',
    'CREATE INDEX IF NOT EXISTS mentions_analysis_status_received_at_idx ON mentions (analysis_status, received_at)',
    'CREATE INDEX IF NOT EXISTS comments_archived_idx ON comments (archived)',
    'CREATE INDEX IF NOT EXISTS mentions_quality_idx ON mentions (quality)',
  ]
  for (const ddl of INDEXES) {
    try {
      await knex.raw(ddl)
    } catch (err: any) {
      strapi.log.error(`pulse: index creation failed (${ddl}): ${err.message}`)
      await (strapi.service('api::notify.slack') as any)
        .ops(`index creation failed at boot: ${ddl} — ${err.message}`)
        .catch(() => {})
    }
  }

  strapi.log.info(
    `pulse: mention dedupe done (${dupes.length} duplicated externalId(s) merged), unique + hot-filter indexes ensured`
  )
}
