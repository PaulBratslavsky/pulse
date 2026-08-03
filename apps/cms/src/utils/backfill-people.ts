import type { Core } from '@strapi/strapi'

/**
 * Resolve every existing mention to a Person.
 *
 * Idempotent and self-limiting: it only touches mentions whose `person` link is
 * missing, so it costs one cheap query on every boot after the first run. It
 * runs at bootstrap rather than as a one-off script because the corpus keeps
 * growing and a mention that failed identity resolution once (a transient error
 * in `ensure`) should get another chance rather than staying orphaned forever.
 */
export async function backfillPeople(strapi: Core.Strapi) {
  const knex = strapi.db.connection

  // Link tables, not FK columns — mention.person lives in mentions_person_lnk.
  // Reading `row.person_id` here would silently return undefined for every row
  // and "backfill" the entire corpus onto nothing.
  const orphans: any[] = await knex('mentions as m')
    .leftJoin('mentions_person_lnk as pl', 'pl.mention_id', 'm.id')
    .leftJoin('mentions_channel_lnk as cl', 'cl.mention_id', 'm.id')
    .leftJoin('channels as c', 'c.id', 'cl.channel_id')
    .whereNull('pl.person_id')
    .select(
      'm.id',
      'm.document_id',
      'm.author_handle',
      'm.author_name',
      'm.author_profile_url',
      'm.author_avatar_url',
      'm.author_followers',
      'm.posted_at',
      'm.url',
      'c.key as channel_key',
      'c.document_id as channel_document_id'
    )

  const personService = strapi.service('api::person.person') as any
  let linked = 0
  let unresolved = 0

  for (const row of orphans) {
    try {
      const personId = await personService.ensure({
        authorHandle: row.author_handle,
        authorName: row.author_name,
        authorProfileUrl: row.author_profile_url,
        authorAvatarUrl: row.author_avatar_url,
        authorFollowers: row.author_followers,
        channelKey: row.channel_key,
        channelId: row.channel_document_id ?? null,
        postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      })
      if (!personId) {
        // no URL and no handle — nothing to key on. Not an error.
        unresolved++
        continue
      }
      await strapi.documents('api::mention.mention').update({
        documentId: row.document_id,
        data: {
          person: personId,
          postKind: personService.postKindOf(row.url),
          venue: personService.venueOf(row.url),
        } as any,
      })
      linked++
    } catch (err: any) {
      strapi.log.warn(`pulse: person backfill failed for mention ${row.document_id}: ${err.message}`)
    }
  }

  // ensure() increments mentionCount per sighting, which is right at ingest but
  // wrong here — a person seen 5 times during a re-run would be counted twice.
  // Recompute from the mentions themselves, the mistake muted_authors made.
  const people = await strapi
    .documents('api::person.person')
    .findMany({ fields: ['displayName'] as any, limit: 5000 })
  for (const p of people) {
    await personService.recount(p.documentId)
    // the mute list changes after a person row already exists
    await personService.reclassifyKind(p.documentId)
  }

  strapi.log.info(
    `pulse: backfilled ${linked} mention(s) onto ${people.length} people (${unresolved} had no identity to key on)`
  )
}
