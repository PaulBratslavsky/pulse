/**
 * Pure helpers over a person's social accounts. No Strapi, no I/O.
 *
 * A person now holds N accounts, but almost every view still needs to show ONE
 * — an avatar, a handle, a channel badge. Rather than let each caller invent
 * its own rule (and drift), the choice is made once here.
 */

export type AccountLike = {
  identityKey?: string
  identityProvisional?: boolean
  handle?: string | null
  profileUrl?: string | null
  avatarUrl?: string | null
  followers?: number | null
  followersObservedAt?: string | null
  reachTier?: string | null
  lastSeenAt?: string | null
  channel?: { key?: string; name?: string } | null
}

/**
 * The account to show when there is only room for one.
 *
 * Most recently active wins: it is the presence the person is actually using,
 * which is what someone about to reach out needs. A firm (URL-keyed) account
 * beats a provisional one on a tie, because it is the one with a profile URL
 * worth linking to.
 */
export function primaryAccount<T extends AccountLike>(accounts: T[] | null | undefined): T | null {
  const list = (accounts ?? []).filter(Boolean)
  if (!list.length) return null
  return [...list].sort((a, b) => {
    const t = (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '')
    if (t !== 0) return t
    return Number(a.identityProvisional ?? false) - Number(b.identityProvisional ?? false)
  })[0]
}

/**
 * Reach across every account, not just the primary one.
 *
 * Someone with 200 followers on Bluesky and 40,000 on X has the reach of the X
 * account — taking only the primary would understate them the moment they last
 * posted somewhere small. Still never part of the lead SCORE (see leadContext);
 * this is a fact shown beside it.
 */
export function widestReach<T extends AccountLike>(
  accounts: T[] | null | undefined
): { followers: number | null; reachTier: string; account: T | null } {
  const withCounts = (accounts ?? []).filter((a) => typeof a.followers === 'number')
  if (!withCounts.length) return { followers: null, reachTier: 'unknown', account: null }
  const best = [...withCounts].sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))[0]
  return { followers: best.followers ?? null, reachTier: best.reachTier ?? 'unknown', account: best }
}

/**
 * Every PRESENCE the person posts under, for the alias line on their page.
 *
 * Deduplicated by channel + handle, because one presence is routinely keyed
 * twice: a post without a profile URL keys as `twitter:handle`, one with keys
 * as `x.com/handle`, and the repair pass deliberately keeps both account rows
 * since both were really seen. Listing both would render "@dev X · @dev X" —
 * which reads as two accounts and makes the person MORE ambiguous, the opposite
 * of the point. The row carrying a real profile URL wins, since it is the one
 * worth linking to.
 */
export function aliasesOf<T extends AccountLike>(accounts: T[] | null | undefined) {
  const byPresence = new Map<string, T>()
  for (const a of accounts ?? []) {
    const key = `${a.channel?.key ?? '?'}::${(a.handle ?? '').toLowerCase()}`
    const held = byPresence.get(key)
    const better = !held || (!held.profileUrl && a.profileUrl) || (held.identityProvisional && !a.identityProvisional)
    if (better) byPresence.set(key, a)
  }
  return [...byPresence.values()].map((a) => ({
    identityKey: a.identityKey,
    handle: a.handle ?? null,
    profileUrl: a.profileUrl ?? null,
    channel: a.channel?.key ?? null,
    channelName: a.channel?.name ?? null,
    provisional: Boolean(a.identityProvisional),
  }))
}
