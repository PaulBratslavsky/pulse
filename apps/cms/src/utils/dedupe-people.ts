import type { Core } from '@strapi/strapi'

/**
 * Split-person repair (bootstrap, idempotent).
 *
 * A person's identity key comes from their profile URL when there is one, and
 * falls back to `channel:handle` when there is not (utils/identity.ts). The
 * same presence therefore gets keyed both ways — `twitter:strapijs` from a post
 * with no URL, `x.com/strapijs` from one with — and under the old model those
 * became two PEOPLE, each scored on half the evidence.
 *
 * Since accounts were split out of Person, two keys for one presence is no
 * longer a problem in itself: `ensure()` attaches both accounts to the same
 * person, in either arrival order. What this repairs is the leftovers — two
 * accounts with the same handle on the same channel that are still pointing at
 * different people, whether from before the refactor or from a lost race.
 *
 * Conservative by construction: same handle AND same channel only. Two accounts
 * on different platforms are two people until a human says otherwise — there is
 * no reliable automatic signal for "same human on X and Reddit", and an
 * unpicked bad merge costs more than the duplicate did.
 */
export async function dedupeSplitPeople(strapi: Core.Strapi) {
  const accounts: any[] = await strapi.documents('api::social-account.social-account').findMany({
    populate: { channel: true, person: true } as any,
    limit: 5000,
  })

  // group by handle + channel — the definition of "the same presence"
  const groups = new Map<string, any[]>()
  for (const a of accounts) {
    const handle = (a.handle ?? '').trim().replace(/^@+/, '').toLowerCase()
    if (!handle || !a.person?.documentId) continue
    const key = `${a.channel?.key ?? 'no-channel'}::${handle}`
    groups.set(key, [...(groups.get(key) ?? []), a])
  }

  let merged = 0
  for (const [, group] of groups) {
    const people = [...new Set(group.map((a) => a.person.documentId))]
    if (people.length < 2) continue

    // Keep the person holding the account with a real profile URL — that is the
    // authoritative identity — and fold the rest into them.
    const firm = group.find((a) => !a.identityProvisional) ?? group[0]
    const winner = firm.person.documentId

    for (const loser of people.filter((p) => p !== winner)) {
      try {
        await (strapi.service('api::person.person') as any).merge(loser, winner, null)
        merged++
      } catch (err: any) {
        // One bad row must not stop the rest — the same per-item isolation the
        // octolens sync loop uses.
        strapi.log.warn(`pulse: could not merge split person ${loser}: ${err.message}`)
      }
    }
  }

  if (merged) strapi.log.info(`pulse: person dedupe done (${merged} split identit(ies) merged)`)
  return merged
}
