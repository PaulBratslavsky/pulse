import { factories } from '@strapi/strapi'
import { identityKeyOf, postKindOf, venueOf, threadKeyOf } from '../../../utils/identity'
import { logActivity } from '../../../utils/activity'

/** followers → tier. Corpus percentiles: median 550, p75 1,495, p90 ~12k.
 *  Deliberately NOT part of leadScore — see leadContext in the scoring service. */
export const reachTierOf = (followers?: number | null): 'unknown' | 'small' | 'mid' | 'large' => {
  if (typeof followers !== 'number' || followers < 0) return 'unknown'
  if (followers >= 5000) return 'large'
  if (followers >= 500) return 'mid'
  return 'small'
}

/**
 * Accounts that are not community members. `kind` is load-bearing, not
 * cosmetic: the highest-frequency "authors" in the corpus are our own account
 * (14 mentions), a muted AI content farm, and the brand accounts @webflow and
 * @strapijs. Without this, every frequency-ranked view surfaces exactly those.
 */
/**
 * The handles that used to live here as the only source of truth. They are now
 * SEED data for api::team-handle, which is editable in the admin panel — adding
 * a teammate was previously a deploy, and the list could not be corrected by
 * the person watching their own post get flagged.
 */
export const SEED_TEAM_HANDLES = [
  { handle: 'strapijs', kind: 'own-brand' },
  { handle: 'codingafterthirty', kind: 'own-team' },
  { handle: 'codingthirty', kind: 'own-team' },
]

// Nothing else belongs in that list. It is FROZEN — a record of what used to be
// hardcoded, applied once to an empty environment so nothing regressed. New
// teammates go in the admin panel (Settings → Our handles), which is the whole
// reason this became data. Adding one here would also do nothing for an
// existing environment: seedOnce is marker-guarded and never runs twice.
const COMPETITOR_BRAND = new Set([
  'webflow',
  'contentful',
  'sanity_io',
  'payloadcms',
  'directus',
  'wordpress',
  'ghost',
])

export const kindOf = (handle?: string | null, muted = false, ours = false): string => {
  const h = (handle ?? '').toLowerCase().replace(/^@+/, '')
  if (!h) return 'unknown'
  // `ours` is resolved by the caller from the allowlist and passed in, so this
  // stays a pure function over its inputs rather than reaching for the DB.
  if (ours) return 'own-team'
  if (COMPETITOR_BRAND.has(h)) return 'competitor-brand'
  // A muted author is a bot or content farm by definition — that judgement was
  // already made by a human, and it is the same judgement `kind` encodes. The
  // top non-e2e author in the corpus is a muted AI content farm with 42
  // mentions; without this it ranks first on every frequency-ordered view.
  if (muted) return 'vendor-bot'
  return 'community'
}

/**
 * Follow `mergedInto` to the person who is actually on the board.
 *
 * A sibling account may belong to a row that has since been merged away;
 * attaching a new account to a tombstone would hide it. Bounded rather than
 * recursive — merge() refuses to chain, but a row hand-edited in the admin
 * panel has no such guard, and a cycle here would hang ingest.
 */
const resolveSurvivor = async (strapi: any, documentId: string, hops = 0): Promise<string> => {
  if (hops > 5) return documentId
  const person: any = await strapi
    .documents('api::person.person')
    .findOne({ documentId, populate: { mergedInto: true } as any })
  const next = person?.mergedInto?.documentId
  if (!next || next === documentId) return documentId
  return resolveSurvivor(strapi, next, hops + 1)
}

const isOurs = async (strapi: any, handle?: string | null): Promise<boolean> => {
  if (!handle) return false
  try {
    return Boolean(await (strapi.service('api::team-handle.team-handle') as any).isOurs(handle))
  } catch {
    return false
  }
}

const isMuted = async (strapi: any, handle?: string | null): Promise<boolean> => {
  if (!handle) return false
  try {
    return Boolean(await (strapi.service('api::muted-author.muted-author') as any).isMuted(handle))
  } catch {
    return false
  }
}

export default factories.createCoreService('api::person.person', ({ strapi }) => ({
  // Re-exported through the service so the octolens plugin can reach them. It
  // builds from its own tsconfig and cannot import app code at build time, so
  // every cross-boundary call has to resolve at runtime.
  postKindOf,
  venueOf,
  threadKeyOf,

  /**
   * ensure(): the single way a person is created outside the admin panel.
   * Mirrors topic.ensure — find, create, and on a lost race recover by the key
   * the unique index actually fires on.
   *
   * Resolves an ACCOUNT first, then that account's person. The distinction is
   * the whole model: `identityKey` identifies a presence on one platform, and a
   * human may have several. Person used to carry the key itself, which made one
   * person one platform by construction — the same human on X and on Reddit was
   * two rows, and the only way to say otherwise was a hidden tombstone.
   *
   * ⚠️ Same caveat as topic.ensure: NOT safe inside an ambient
   * strapi.db.transaction on Postgres, because a unique violation aborts the
   * whole transaction and the recovery refetch fails with it. Call it before
   * opening one.
   */
  async ensure(input: {
    authorHandle?: string | null
    authorName?: string | null
    authorProfileUrl?: string | null
    authorAvatarUrl?: string | null
    authorFollowers?: number | null
    channelKey?: string | null
    channelId?: string | null
    postedAt?: string | null
  }): Promise<string | null> {
    const identity = identityKeyOf(input)
    if (!identity) return null

    const now = input.postedAt ?? new Date().toISOString()
    const handle = (input.authorHandle ?? '').trim().replace(/^@+/, '')

    let account: any = await strapi
      .documents('api::social-account.social-account')
      .findFirst({ filters: { identityKey: identity.key } as any, populate: { person: true } as any })

    let personId: string | null = account?.person?.documentId ?? null

    // The same presence is often seen keyed BOTH ways — `twitter:strapijs` from
    // a post with no profile URL, `x.com/strapijs` from one with. Under the old
    // model those forked into two people, and which way round they arrived
    // decided whether anything reconciled them. Now they are simply two
    // accounts of one person, so the rule is symmetric and order stops
    // mattering: same handle, same channel, same human.
    if (!account && handle) {
      const sibling: any = await strapi.documents('api::social-account.social-account').findFirst({
        filters: { handle: { $eqi: handle }, channel: { key: input.channelKey ?? undefined } } as any,
        populate: { person: true } as any,
      })
      if (sibling?.person?.documentId) {
        personId = await resolveSurvivor(strapi, sibling.person.documentId)
        strapi.log.info(
          `pulse: ${identity.key} joins the person already holding ${sibling.identityKey}`
        )
      }
    }

    if (!personId) {
      const person = await strapi.documents('api::person.person').create({
        data: {
          displayName: input.authorName ?? null,
          kind: kindOf(
            input.authorHandle,
            await isMuted(strapi, input.authorHandle),
            await isOurs(strapi, input.authorHandle)
          ),
          firstSeenAt: now,
          lastSeenAt: now,
          mentionCount: 1,
        } as any,
      })
      personId = person.documentId
    } else {
      // Enrich on every sighting. Fields fill in rather than overwrite — a
      // later mention that happens to omit the avatar must not erase the one
      // we already have.
      const person: any = await strapi.documents('api::person.person').findOne({ documentId: personId })
      const patch: Record<string, unknown> = {
        lastSeenAt: now > (person?.lastSeenAt ?? '') ? now : person?.lastSeenAt,
        // recomputed on read by the backfill/repair; maintained here so the
        // number is never a write-once snapshot the way muted_authors.mentionCount was
        mentionCount: (person?.mentionCount ?? 0) + 1,
      }
      if (!person?.displayName && input.authorName) patch.displayName = input.authorName
      if (!person?.firstSeenAt || now < person.firstSeenAt) patch.firstSeenAt = now
      await strapi
        .documents('api::person.person')
        .update({ documentId: personId, data: patch as any })
    }

    if (!account) {
      try {
        account = await strapi.documents('api::social-account.social-account').create({
          data: {
            identityKey: identity.key,
            identityProvisional: identity.provisional,
            handle: handle || null,
            profileUrl: input.authorProfileUrl ?? null,
            avatarUrl: input.authorAvatarUrl ?? null,
            followers: input.authorFollowers ?? null,
            followersObservedAt: typeof input.authorFollowers === 'number' ? now : null,
            reachTier: reachTierOf(input.authorFollowers),
            channel: input.channelId ?? null,
            firstSeenAt: now,
            lastSeenAt: now,
            person: personId,
          } as any,
        })
        return personId
      } catch (err) {
        // Lost race: the unique index on identityKey fired. Recover by it.
        account = await strapi
          .documents('api::social-account.social-account')
          .findFirst({ filters: { identityKey: identity.key } as any, populate: { person: true } as any })
        if (!account) throw err
        return account.person?.documentId ?? personId
      }
    }

    const accountPatch: Record<string, unknown> = {
      lastSeenAt: now > (account.lastSeenAt ?? '') ? now : account.lastSeenAt,
    }
    if (!account.profileUrl && input.authorProfileUrl) accountPatch.profileUrl = input.authorProfileUrl
    if (!account.avatarUrl && input.authorAvatarUrl) accountPatch.avatarUrl = input.authorAvatarUrl
    if (!account.handle && handle) accountPatch.handle = handle
    if (!account.firstSeenAt || now < account.firstSeenAt) accountPatch.firstSeenAt = now
    // followers DO overwrite — "latest known" is the point, and the
    // point-in-time value is preserved on each mention row
    if (typeof input.authorFollowers === 'number') {
      accountPatch.followers = input.authorFollowers
      accountPatch.followersObservedAt = now
      accountPatch.reachTier = reachTierOf(input.authorFollowers)
    }
    await strapi
      .documents('api::social-account.social-account')
      .update({ documentId: account.documentId, data: accountPatch as any })

    return personId
  },

  /** Re-derive `kind` for an existing person (the mute list changes over time). */
  async reclassifyKind(documentId: string) {
    const person: any = await strapi
      .documents('api::person.person')
      .findOne({ documentId, populate: { socialAccounts: true } as any })
    if (!person) return null
    // The handle lives on the account now. Any account matching an own-team or
    // competitor handle settles it — a brand posting from two platforms is
    // still a brand.
    const handles: string[] = (person.socialAccounts ?? []).map((a: any) => a.handle).filter(Boolean)
    const muted = await Promise.all(handles.map((h) => isMuted(strapi, h)))
    const ours = await Promise.all(handles.map((h) => isOurs(strapi, h)))
    const kinds = handles.map((h, i) => kindOf(h, muted[i], ours[i]))
    const next = kinds.find((k) => k !== 'community' && k !== 'unknown') ?? kinds[0] ?? 'unknown'
    if (next === person.kind) return person
    return strapi
      .documents('api::person.person')
      .update({ documentId, data: { kind: next } as any })
  },

  /**
   * Recompute the counters from the mentions themselves.
   * `muted_authors.mentionCount` is a write-once snapshot and is already wrong
   * on 7 of 7 rows (one reads 27 where the truth is 42). Derived state has to
   * be derivable on demand or it rots exactly like that.
   */
  async recount(documentId: string) {
    const person = await strapi
      .documents('api::person.person')
      .findOne({ documentId, populate: { mentions: true } as any })
    if (!person) return null
    const mentions: any[] = (person as any).mentions ?? []
    const dates = mentions.map((m) => m.postedAt ?? m.receivedAt).filter(Boolean).sort()
    return strapi.documents('api::person.person').update({
      documentId,
      data: {
        mentionCount: mentions.length,
        firstSeenAt: dates[0] ?? person.firstSeenAt,
        lastSeenAt: dates[dates.length - 1] ?? person.lastSeenAt,
      } as any,
    })
  },

  /**
   * Fold one person into another.
   *
   * Unlike the mention deduper, the loser is NOT deleted. `Person.mergedInto`
   * exists precisely so it survives as a tombstone: `person.leads` already
   * filters `mergedInto: $null`, so a merged row leaves the board on its own,
   * while an old link, a bookmark or a stored `strongestMention` reference
   * still resolves to something rather than 404ing. Deleting would also drop
   * the relation link rows and orphan the very history this exists to preserve.
   *
   * NOT transaction-wrapped, deliberately: `ensure()` documents that Document
   * Service writes on Postgres abort the whole transaction on a unique
   * violation, and the caller (boot repair, or a human) is better served by a
   * partial merge it can re-run — this is idempotent — than by an all-or-
   * nothing that fails silently at scale.
   */
  // `actor` is the TEAM MEMBER doing the merge (a users-permissions user), not
  // either of the people being merged — it exists only so the activity trail
  // records who made the call. Same third argument as leads.setStatus().
  async merge(loserDocumentId: string, winnerDocumentId: string, actor?: { id: number } | null) {
    if (loserDocumentId === winnerDocumentId) {
      throw Object.assign(new Error('a person cannot be merged into themselves'), { status: 400 })
    }
    const [loser, winner]: any[] = await Promise.all([
      strapi.documents('api::person.person').findOne({
        documentId: loserDocumentId,
        // mergedInto must be POPULATED or the already-merged guard below reads
        // undefined and silently lets a second merge through — a relation is
        // absent, not null, when you do not ask for it.
        populate: { mentions: true, socialAccounts: true, mergedInto: true } as any,
      }),
      strapi.documents('api::person.person').findOne({
        documentId: winnerDocumentId,
        populate: { mergedInto: true, owner: true } as any,
      }),
    ])
    if (!loser) throw Object.assign(new Error('person to merge not found'), { status: 404 })
    if (!winner) throw Object.assign(new Error('person to merge into not found'), { status: 404 })
    // Chaining merges would strand history behind two hops and makes the
    // tombstone meaningless. Merge into the surviving row instead.
    if (loser.mergedInto) throw Object.assign(new Error('that person is already merged'), { status: 409 })
    if (winner.mergedInto)
      throw Object.assign(new Error('cannot merge into an already-merged person'), { status: 409 })

    // Re-parent the children. Same shape as utils/dedupe-mentions.ts: move
    // them, never delete them.
    const mentions: any[] = loser.mentions ?? []
    for (const m of mentions) {
      await strapi
        .documents('api::mention.mention')
        .update({ documentId: m.documentId, data: { person: winnerDocumentId } as any })
    }
    const [comments, activities] = await Promise.all([
      strapi.documents('api::comment.comment').findMany({
        filters: { person: { documentId: loserDocumentId } } as any,
        limit: 500,
      }),
      strapi.documents('api::activity.activity').findMany({
        filters: { person: { documentId: loserDocumentId } } as any,
        limit: 500,
      }),
    ])
    for (const c of comments) {
      await strapi
        .documents('api::comment.comment')
        .update({ documentId: c.documentId, data: { person: winnerDocumentId } as any })
    }
    for (const a of activities) {
      await strapi
        .documents('api::activity.activity')
        .update({ documentId: a.documentId, data: { person: winnerDocumentId } as any })
    }

    // The accounts move wholesale — this is what a merge now MEANS. Handle,
    // profile URL, avatar, followers and reach live on the account, so none of
    // them need reconciling: the winner simply ends up holding both presences,
    // which is the fact we are asserting.
    for (const acc of loser.socialAccounts ?? []) {
      await strapi
        .documents('api::social-account.social-account')
        .update({ documentId: acc.documentId, data: { person: winnerDocumentId } as any })
    }

    // Fill gaps only — a merge must never overwrite what the winner already
    // knows, and must never walk the lifecycle backwards.
    const carry: Record<string, unknown> = {}
    if (!winner.displayName && loser.displayName) carry.displayName = loser.displayName
    if (!winner.owner && loser.owner) carry.owner = loser.owner.id ?? loser.owner
    if (winner.status === 'new' && loser.status && loser.status !== 'new') {
      carry.status = loser.status
      carry.statusChangedAt = loser.statusChangedAt ?? new Date().toISOString()
    }
    if (Object.keys(carry).length) {
      await strapi
        .documents('api::person.person')
        .update({ documentId: winnerDocumentId, data: carry as any })
    }

    await strapi.documents('api::person.person').update({
      documentId: loserDocumentId,
      data: { mergedInto: winnerDocumentId, mentionCount: 0 } as any,
    })

    // Counters are DERIVED — recount from the mentions rather than adding two
    // numbers that were each already suspect (see recount's own note).
    await (this as any).recount(winnerDocumentId)
    await logActivity(strapi, {
      personDocumentId: winnerDocumentId,
      action: 'person-merged',
      actorId: actor?.id ?? null,
      detail: {
        from: (loser.socialAccounts ?? []).map((a: any) => a.identityKey),
        mentions: mentions.length,
        comments: comments.length,
        accounts: (loser.socialAccounts ?? []).length,
      },
    })
    // The merged mention set changes the score, and `repeat-signal` can now
    // fire where neither half qualified alone.
    await (strapi.service('api::person.leads') as any)
      .persist(winnerDocumentId)
      .catch((err: Error) => strapi.log.warn(`[person] rescore after merge failed: ${err.message}`))

    strapi.log.info(
      `pulse: merged person ${loserDocumentId} into ${winnerDocumentId} (moved ${(loser.socialAccounts ?? []).length} account(s), ${mentions.length} mention(s), ${comments.length} comment(s), ${activities.length} activit(ies))`
    )
    return { merged: loserDocumentId, into: winnerDocumentId, mentions: mentions.length }
  },
}))
