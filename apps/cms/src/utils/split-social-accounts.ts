import type { Core } from '@strapi/strapi'

/**
 * Move platform identity off Person and onto SocialAccount (bootstrap, idempotent).
 *
 * Why: `Person` was one row per social account by construction — `identityKey`
 * unique and required, `channel` a single relation — so the same human on X and
 * on Reddit was two people, and the only way to express "these are the same
 * person" was a `mergedInto` tombstone with one half hidden. A person is now an
 * internal id with N accounts hanging off it, which is what the data always was.
 *
 * PHASE A of a deliberate two-phase change. This copies; it deletes nothing.
 * The old columns are removed from person/schema.json only once this has run
 * everywhere, because Strapi drops a column the moment its attribute leaves the
 * schema — a one-phase change would destroy the source data on boot. The same
 * two deploys are needed in production.
 */
export async function splitSocialAccounts(strapi: Core.Strapi) {
  const knex = strapi.db.connection

  // Read raw: the columns being migrated may already be gone from the schema on
  // a later boot, in which case the document service would not return them and
  // this has nothing left to do anyway.
  const hasColumn = await knex.schema.hasColumn('people', 'identity_key')
  if (!hasColumn) return 0

  const people: any[] = await knex('people').select('*')
  let created = 0
  let relinked = 0

  for (const row of people) {
    if (!row.identity_key) continue

    // Idempotent: the account may already exist from a previous boot.
    const existing = await strapi.documents('api::social-account.social-account').findFirst({
      filters: { identityKey: row.identity_key } as any,
    })

    // Where the account should point. A tombstoned person (mergedInto set) is
    // half of a human we already know about — its account belongs to the
    // SURVIVOR, which is the whole point of the new model: two accounts, one
    // person, instead of one hidden row.
    const winnerId = await resolveSurvivor(knex, row.id)
    const winner: any = await knex('people').where({ id: winnerId }).first()
    if (!winner) continue

    const personDoc = await strapi
      .documents('api::person.person')
      .findFirst({ filters: { documentId: winner.document_id } as any })
    if (!personDoc) continue

    if (existing) {
      // Re-point if a merge happened after the account row was written.
      const current = await knex('social_accounts_person_lnk')
        .where({ social_account_id: (existing as any).id })
        .first()
      if (!current || current.person_id !== winner.id) {
        await strapi.documents('api::social-account.social-account').update({
          documentId: existing.documentId,
          data: { person: personDoc.documentId } as any,
        })
        relinked++
      }
      continue
    }

    // channel is a link row on the source, not a column
    const channelLink = await knex('people_channel_lnk').where({ person_id: row.id }).first()
    const channelDoc = channelLink
      ? await knex('channels').where({ id: channelLink.channel_id }).first()
      : null

    await strapi.documents('api::social-account.social-account').create({
      data: {
        identityKey: row.identity_key,
        identityProvisional: Boolean(row.identity_provisional),
        handle: row.handle ?? null,
        profileUrl: row.profile_url ?? null,
        avatarUrl: row.avatar_url ?? null,
        followers: row.followers ?? null,
        followersObservedAt: row.followers_observed_at ?? null,
        reachTier: row.reach_tier ?? 'unknown',
        firstSeenAt: row.first_seen_at ?? null,
        lastSeenAt: row.last_seen_at ?? null,
        channel: channelDoc?.document_id ?? null,
        person: personDoc.documentId,
      } as any,
    })
    created++
  }

  if (created || relinked) {
    strapi.log.info(
      `pulse: social accounts split out (${created} created, ${relinked} re-pointed after a merge)`
    )
  }
  return created + relinked
}

/**
 * Follow `mergedInto` to the surviving person.
 *
 * Bounded rather than recursive: a cycle in the tombstone chain would otherwise
 * hang boot, and merge() refuses to chain — but a hand-edited row in the admin
 * panel has no such guard.
 */
async function resolveSurvivor(knex: any, personId: number, hops = 0): Promise<number> {
  if (hops > 5) return personId
  const link = await knex('people_merged_into_lnk').where({ person_id: personId }).first()
  if (!link?.inv_person_id || link.inv_person_id === personId) return personId
  return resolveSurvivor(knex, link.inv_person_id, hops + 1)
}
