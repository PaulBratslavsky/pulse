import type { Core } from '@strapi/strapi'

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
      populate: { responses: true, comments: true, owner: true } as any,
      sort: 'createdAt:asc' as any,
    })
    if (rows.length < 2) continue
    const score = (m: any) =>
      (m.responses?.length ?? 0) * 10 +
      (m.comments?.length ?? 0) * 10 +
      (m.owner ? 5 : 0) +
      (m.status !== 'unanswered' ? 3 : 0)
    // highest workflow value wins; tie → oldest row
    const keep = [...rows].sort((a, b) => score(b) - score(a))[0]
    for (const row of rows) {
      if (row.documentId === keep.documentId) continue
      await strapi.documents('api::mention.mention').delete({ documentId: row.documentId })
      strapi.log.warn(
        `pulse: removed duplicate mention ${row.documentId} (externalId ${external_id}, kept ${keep.documentId})`
      )
    }
  }

  // real DB-level guard (works on SQLite and Postgres; NULLs unaffected)
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS mentions_external_id_uq ON mentions (external_id)')
  strapi.log.info(
    `pulse: mention dedupe done (${dupes.length} duplicated externalId(s) merged), unique index ensured`
  )
}
