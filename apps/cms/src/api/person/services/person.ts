import { factories } from '@strapi/strapi'
import { identityKeyOf, postKindOf, venueOf } from '../../../utils/identity'

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
const OWN_TEAM = new Set(['strapijs', 'codingafterthirty', 'codingthirty'])
const COMPETITOR_BRAND = new Set([
  'webflow',
  'contentful',
  'sanity_io',
  'payloadcms',
  'directus',
  'wordpress',
  'ghost',
])

export const kindOf = (handle?: string | null, muted = false): string => {
  const h = (handle ?? '').toLowerCase().replace(/^@+/, '')
  if (!h) return 'unknown'
  if (OWN_TEAM.has(h)) return 'own-team'
  if (COMPETITOR_BRAND.has(h)) return 'competitor-brand'
  // A muted author is a bot or content farm by definition — that judgement was
  // already made by a human, and it is the same judgement `kind` encodes. The
  // top non-e2e author in the corpus is a muted AI content farm with 42
  // mentions; without this it ranks first on every frequency-ordered view.
  if (muted) return 'vendor-bot'
  return 'community'
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

  /**
   * ensure(): the single way a person is created outside the admin panel.
   * Mirrors topic.ensure — find, create, and on a lost race recover by the key
   * the unique index actually fires on.
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

    let person = await strapi
      .documents('api::person.person')
      .findFirst({ filters: { identityKey: identity.key } as any })

    // A provisional (handle-keyed) identity may be the same account as one we
    // already know by URL on the same channel — @strapijs appears in the corpus
    // both ways. Adopt the authoritative record instead of forking the person.
    if (!person && identity.provisional) {
      const handle = (input.authorHandle ?? '').trim().replace(/^@+/, '')
      if (handle) {
        person = await strapi.documents('api::person.person').findFirst({
          filters: {
            handle: { $eqi: handle },
            identityProvisional: false,
            channel: { key: input.channelKey ?? undefined },
          } as any,
        })
      }
    }

    const now = input.postedAt ?? new Date().toISOString()

    if (!person) {
      try {
        person = await strapi.documents('api::person.person').create({
          data: {
            identityKey: identity.key,
            identityProvisional: identity.provisional,
            handle: (input.authorHandle ?? '').replace(/^@+/, '') || null,
            displayName: input.authorName ?? null,
            profileUrl: input.authorProfileUrl ?? null,
            avatarUrl: input.authorAvatarUrl ?? null,
            followers: input.authorFollowers ?? null,
            followersObservedAt: typeof input.authorFollowers === 'number' ? now : null,
            reachTier: reachTierOf(input.authorFollowers),
            kind: kindOf(input.authorHandle, await isMuted(strapi, input.authorHandle)),
            channel: input.channelId ?? null,
            firstSeenAt: now,
            lastSeenAt: now,
            mentionCount: 1,
          } as any,
        })
        return person.documentId
      } catch (err) {
        person = await strapi
          .documents('api::person.person')
          .findFirst({ filters: { identityKey: identity.key } as any })
        if (!person) throw err
      }
    }

    // Enrich on every sighting. Fields fill in rather than overwrite — a later
    // mention that happens to omit the avatar must not erase the one we have.
    const patch: Record<string, unknown> = {
      lastSeenAt: now > (person.lastSeenAt ?? '') ? now : person.lastSeenAt,
      // recomputed on read by the backfill/repair; maintained here so the
      // number is never a write-once snapshot the way muted_authors.mentionCount was
      mentionCount: (person.mentionCount ?? 0) + 1,
    }
    if (!person.displayName && input.authorName) patch.displayName = input.authorName
    if (!person.profileUrl && input.authorProfileUrl) patch.profileUrl = input.authorProfileUrl
    if (!person.avatarUrl && input.authorAvatarUrl) patch.avatarUrl = input.authorAvatarUrl
    if (!person.handle && input.authorHandle) patch.handle = input.authorHandle.replace(/^@+/, '')
    if (!person.firstSeenAt || now < person.firstSeenAt) patch.firstSeenAt = now
    // followers DO overwrite — "latest known" is the point, and the
    // point-in-time value is preserved on each mention row
    if (typeof input.authorFollowers === 'number') {
      patch.followers = input.authorFollowers
      patch.followersObservedAt = now
      patch.reachTier = reachTierOf(input.authorFollowers)
    }

    await strapi
      .documents('api::person.person')
      .update({ documentId: person.documentId, data: patch as any })
    return person.documentId
  },

  /** Re-derive `kind` for an existing person (the mute list changes over time). */
  async reclassifyKind(documentId: string) {
    const person: any = await strapi.documents('api::person.person').findOne({ documentId })
    if (!person) return null
    const next = kindOf(person.handle, await isMuted(strapi, person.handle))
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
}))
