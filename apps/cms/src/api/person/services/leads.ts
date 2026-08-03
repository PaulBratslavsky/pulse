import type { Core } from '@strapi/strapi'
import {
  INTENT_SIGNALS,
  intentDecay,
  bandOf,
  type LeadDirection,
} from '../../../classification/criteria'
import { logActivity } from '../../../utils/activity'

const daysBetween = (iso: string | null | undefined, now: number): number => {
  if (!iso) return Number.POSITIVE_INFINITY
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : (now - t) / 86_400_000
}

const pointsFor = (id: string) => INTENT_SIGNALS.find((s) => s.id === id)?.points ?? 0

const COMPETITORS = [
  'webflow',
  'contentful',
  'sanity',
  'payload',
  'directus',
  'wordpress',
  'wix',
  'ghost',
  'prismic',
  'storyblok',
]

export type ScoredLead = {
  score: number
  band: ReturnType<typeof bandOf>
  direction: LeadDirection
  /** every signal that fired, so the number is always explainable */
  signals: { id: string; points: number; label: string }[]
  context: Record<string, unknown>
}

const leads = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Score one person from their mentions. Pure-ish: reads mentions, returns a
   * shape. `persist` writes it.
   *
   * Only community members are scored. Our own account, competitor brands and
   * bot feeds are the highest-frequency authors in the corpus, so scoring them
   * would put them straight at the top of the leads list.
   */
  async score(documentId: string): Promise<ScoredLead | null> {
    const person: any = await strapi.documents('api::person.person').findOne({
      documentId,
      populate: { mentions: true } as any,
    })
    if (!person) return null

    const none: ScoredLead = {
      score: 0,
      band: 'none',
      direction: 'none',
      signals: [],
      context: { skipped: `not scored — kind is ${person.kind}` },
    }
    if (person.kind && person.kind !== 'community' && person.kind !== 'unknown') return none

    const mentions: any[] = person.mentions ?? []
    const now = Date.now()
    const signals: { id: string; points: number; label: string }[] = []
    const add = (id: string) => {
      if (signals.some((s) => s.id === id)) return
      const sig = INTENT_SIGNALS.find((s) => s.id === id)
      if (sig) signals.push({ id: sig.id, points: sig.points, label: sig.label })
    }

    // Score from the STRONGEST single mention, then decay by ITS age — not the
    // person's. Averaging across posts would let a dozen idle comments dilute
    // one clear "we are evaluating a CMS", which is the whole signal.
    let best: any = null
    let bestRaw = 0
    let intentBearing = 0

    for (const m of mentions) {
      if (m.quality === 'spam') continue
      // The lead lane is a PREREQUISITE, not a signal that adds up with the
      // others. Scored additively, "named a competitor" + "Octolens rated it
      // relevant" produced 168 leads out of 200 — people who merely said the
      // word "wordpress" in a post, including one of our own employees. Both
      // are corroboration; neither is evidence that anyone is choosing
      // anything. No lane, no lead.
      if (m.lane !== 'lead') continue
      let raw = 0
      {
        raw += pointsFor('lead-lane')
        // The verified quote is the strongest signal by a wide margin: it is
        // the author's own words, checked server-side to appear in the post.
        // Inferred intent cannot earn this.
        if (m.laneEvidence) raw += pointsFor('verified-evidence')
      }
      if (typeof m.relevanceScore === 'number' && m.relevanceScore >= 0.7)
        raw += pointsFor('octolens-relevance')
      const text = `${m.content ?? ''} ${(m.matchedKeywords ?? []).join(' ')}`.toLowerCase()
      if (COMPETITORS.some((c) => text.includes(c))) raw += pointsFor('competitor-named')
      if (raw > 0) intentBearing++
      if (raw > bestRaw) {
        bestRaw = raw
        best = m
      }
    }

    if (!best) return none

    add('lead-lane')
    if (best.laneEvidence) add('verified-evidence')
    if (typeof best.relevanceScore === 'number' && best.relevanceScore >= 0.7)
      add('octolens-relevance')
    const bestText = `${best.content ?? ''} ${(best.matchedKeywords ?? []).join(' ')}`.toLowerCase()
    const competitor = COMPETITORS.find((c) => bestText.includes(c)) ?? null
    if (competitor) add('competitor-named')
    if (intentBearing > 1) {
      add('repeat-signal')
      bestRaw += pointsFor('repeat-signal')
    }

    const age = daysBetween(best.postedAt ?? best.receivedAt, now)
    const decay = intentDecay(age)
    const score = Math.round(Math.min(100, bestRaw) * decay)

    const direction: LeadDirection = (best.leadDirection as LeadDirection) ?? 'none'

    return {
      score,
      band: bandOf(score),
      direction,
      signals,
      // A facts panel, never arithmetic. Followers appear here and nowhere in
      // the score — asserted by the e2e "fit trap" test.
      context: {
        followers:
          typeof person.followers === 'number'
            ? person.followers
            : `not available on ${person.channel?.key ?? 'this platform'}`,
        reachTier: person.reachTier,
        venue: best.venue ?? null,
        postKind: best.postKind ?? 'unknown',
        competitor,
        language: best.language ?? null,
        strongestMention: best.documentId,
        evidence: best.laneEvidence ?? null,
        ageDays: Number.isFinite(age) ? Math.round(age) : null,
        decayApplied: Number(decay.toFixed(2)),
      },
    }
  },

  async persist(documentId: string) {
    const scored = await this.score(documentId)
    if (!scored) return null
    const before: any = await strapi
      .documents('api::person.person')
      .findOne({ documentId, fields: ['leadBand'] as any })

    const updated = await strapi.documents('api::person.person').update({
      documentId,
      data: {
        leadScore: scored.score,
        leadBand: scored.band,
        leadContext: { signals: scored.signals, direction: scored.direction, ...scored.context } as any,
        leadScoredAt: new Date().toISOString(),
      } as any,
    })

    // Log the BAND crossing, not every rescore. Now that the sweep rescores on
    // every lane change, an entry per run would bury the notes — the same thing
    // that made setStatus skip no-op transitions. A band change is the only
    // part of a score a human acts on.
    if (before && before.leadBand !== scored.band) {
      await logActivity(strapi, {
        personDocumentId: documentId,
        action: 'person-scored',
        actorId: null,
        detail: { from: before.leadBand ?? 'none', to: scored.band, score: scored.score },
      })
    }
    return updated
  },

  /** Rescore everyone. Cheap — no model calls, pure arithmetic over stored rows. */
  async rescoreAll() {
    const people = await strapi
      .documents('api::person.person')
      .findMany({ fields: ['identityKey'] as any, limit: 5000 })
    let scored = 0
    for (const p of people) {
      await this.persist(p.documentId)
      scored++
    }
    strapi.log.info(`[leads] rescored ${scored} people`)
    return scored
  },

  /** Lifecycle transition, logged with the acting user. */
  async setStatus(documentId: string, status: string, user: any) {
    const allowed = ['new', 'watching', 'contacted', 'qualified', 'not-a-fit']
    if (!allowed.includes(status)) {
      const err: any = new Error(`status must be one of ${allowed.join(', ')}`)
      err.status = 400
      throw err
    }
    const before: any = await strapi.documents('api::person.person').findOne({ documentId })
    if (!before) {
      const err: any = new Error('person not found')
      err.status = 404
      throw err
    }
    // Selecting the value that is already set is not a transition. Logging it
    // anyway filled the timeline with "contacted → contacted" lines and buried
    // the notes, which are the only entries anyone actually reads.
    if (before.status === status) return before

    const updated = await strapi.documents('api::person.person').update({
      documentId,
      data: {
        status,
        statusChangedAt: new Date().toISOString(),
        // taking a lead out of 'new' claims it, the same way claiming a mention does
        owner: before.owner ?? user?.id ?? null,
      } as any,
    })
    await logActivity(strapi, {
      personDocumentId: documentId,
      action: 'person-status',
      actorId: user?.id ?? null,
      detail: { from: before.status, to: status },
    })
    return updated
  },
})

export default leads
