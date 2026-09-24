import { factories } from '@strapi/strapi'
import { COUNTS_AS_SIGNAL } from '../../analysis/services/insights'

/**
 * Noise filter, keyed on topic.
 *
 * The problem: Octolens listens for competitor terms that are not actually our
 * competitors. Webflow is the worst offender — 218 themed mentions in a 30-day
 * window against 69 for Strapi itself — so trends, theme reports and topic
 * volumes described Webflow's community rather than ours.
 *
 * Why topic and not keyword: intake's `competitorTopicNames` already turns
 * Octolens's own matched keywords into `kind: competitor` topics BEFORE the AI
 * sweep runs. The topic is the keyword, already attached, already audited. A
 * parallel keyword list would be a second source of truth for the same fact.
 *
 * What muting does (narrower than muting an author, on purpose):
 *  - drops the mention from every analytic — trends, themes, topic volumes, the
 *    Pulse score — via the shared filter in `api::analysis.insights`
 *  - stops the AI sweep spending tokens analyzing or drafting it
 *  - leaves it stored, labeled and readable in the monitor lane
 *
 * What it does NOT do: touch `status`. Muting an author closes their open items
 * because a muted author needs no reply; a muted topic is discourse we still
 * want to be able to read, and monitor-lane items were never in the reply queue
 * to begin with.
 *
 * Lead-lane carve-out: `lane: 'lead'` is never muted. "Leaving Webflow, need a
 * headless CMS" names a muted topic and is the most valuable thing in the
 * corpus. Muting a topic can therefore never cost a lead.
 */
export default factories.createCoreService('api::muted-topic.muted-topic', ({ strapi }) => ({
  /** Every muted slug, as a Set — intake checks this per mention, so it stays one query. */
  async mutedSlugs(): Promise<Set<string>> {
    const rows = await strapi
      .documents('api::muted-topic.muted-topic')
      .findMany({ fields: ['slug'], limit: 500 })
    return new Set((rows as any[]).map((r) => r.slug).filter(Boolean))
  },

  /**
   * The same set keyed by topic documentId. Intake has already resolved topics
   * to ids by the time it needs this, and deriving a slug from a title-cased
   * keyword would be guessing at `uid` generation.
   */
  async mutedTopicIds(): Promise<Set<string>> {
    const rows = await strapi
      .documents('api::muted-topic.muted-topic')
      .findMany({ fields: ['slug'], populate: { topic: { fields: ['slug'] } } as any, limit: 500 })
    return new Set((rows as any[]).map((r) => r.topic?.documentId).filter(Boolean))
  },

  async isMuted(slug: string | null | undefined): Promise<boolean> {
    if (!slug) return false
    const hit = await strapi
      .documents('api::muted-topic.muted-topic')
      .findFirst({ filters: { slug: { $eqi: slug } } as any })
    return Boolean(hit)
  },

  /**
   * True if any of these topic slugs is muted. The shape intake and the sweep
   * need: a mention carries several topics and one muted topic is enough.
   */
  async anyMuted(slugs: (string | null | undefined)[]): Promise<boolean> {
    const wanted = slugs.filter(Boolean) as string[]
    if (!wanted.length) return false
    const muted = await this.mutedSlugs()
    return wanted.some((s) => muted.has(s))
  },

  /** Mute + retro-flag every existing mention carrying that topic. */
  async mute(slug: string, { reason, note, userId }: { reason?: string; note?: string; userId?: number }) {
    const topic: any = await strapi
      .documents('api::topic.topic')
      .findFirst({ filters: { slug: { $eqi: slug } } as any })
    if (!topic) return { muted: false, reason: 'topic not found' as const }

    const existing = await strapi
      .documents('api::muted-topic.muted-topic')
      .findFirst({ filters: { slug: { $eqi: topic.slug } } as any })

    // lane 'lead' is excluded in the query, not filtered after: a lead must
    // never be flagged even transiently, and the count we store should reflect
    // what was actually muted.
    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { topics: { slug: topic.slug }, lane: { $ne: 'lead' } } as any,
      fields: ['topicMuted', 'analysisStatus'],
      limit: 5000,
    })
    for (const m of mentions as any[]) {
      if (m.topicMuted === true) continue
      await strapi.documents('api::mention.mention').update({
        documentId: m.documentId,
        data: {
          topicMuted: true,
          // 'pending' would otherwise mean "awaiting analysis" forever, since
          // the sweep now skips muted rows. 'skipped' is also what makes
          // unmuting self-healing: the sweep already re-picks skipped rows, so
          // clearing the flag is enough to get them analyzed.
          ...(m.analysisStatus === 'pending' ? { analysisStatus: 'skipped' } : {}),
        } as any,
      })
    }

    const data = {
      slug: topic.slug,
      topic: topic.documentId,
      reason: reason ?? 'not-a-competitor',
      note: note ?? null,
      mentionCount: mentions.length,
      ...(userId ? { mutedBy: userId } : {}),
    }
    const record: any = existing
      ? await strapi
          .documents('api::muted-topic.muted-topic')
          .update({ documentId: existing.documentId, data: data as any })
      : await strapi.documents('api::muted-topic.muted-topic').create({ data: data as any })

    strapi.log.info(`[mute-topic] ${topic.slug} muted (${mentions.length} mention(s) flagged)`)
    return {
      muted: true,
      slug: topic.slug,
      name: topic.name,
      mentionsFlagged: mentions.length,
      documentId: record.documentId,
    }
  },

  /**
   * Unmute + restore. The subtlety: a mention tagged [Webflow, Competitor] with
   * BOTH muted must stay flagged when only Webflow is unmuted. So the flag is
   * recomputed against the remaining mute list rather than blindly cleared.
   */
  async unmute(documentId: string) {
    const record: any = await strapi.documents('api::muted-topic.muted-topic').findOne({ documentId })
    if (!record) return { unmuted: false, reason: 'not found' as const }

    await strapi.documents('api::muted-topic.muted-topic').delete({ documentId })
    const stillMuted = await this.mutedSlugs()

    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { topics: { slug: record.slug }, topicMuted: true } as any,
      fields: ['topicMuted'],
      populate: { topics: { fields: ['slug'] } } as any,
      limit: 5000,
    })
    let restored = 0
    for (const m of mentions as any[]) {
      const slugs: string[] = (m.topics ?? []).map((t: any) => t.slug).filter(Boolean)
      if (slugs.some((s) => stillMuted.has(s))) continue
      await strapi
        .documents('api::mention.mention')
        .update({ documentId: m.documentId, data: { topicMuted: false } as any })
      restored += 1
    }

    strapi.log.info(`[mute-topic] ${record.slug} unmuted (${restored} mention(s) restored)`)
    return { unmuted: true, slug: record.slug, mentionsRestored: restored }
  },

  /**
   * Reconcile the flag across history. Intake only sees new mentions and the AI
   * sweep can attach a muted topic to an old row long after it was muted, so
   * the denormalized flag drifts. Idempotent; safe to run on a schedule.
   */
  async rescan() {
    const muted = await this.mutedSlugs()
    const mentions = await strapi.documents('api::mention.mention').findMany({
      fields: ['topicMuted', 'lane'],
      populate: { topics: { fields: ['slug'] } } as any,
      limit: 5000,
    })
    let flagged = 0
    let restored = 0
    for (const m of mentions as any[]) {
      const slugs: string[] = (m.topics ?? []).map((t: any) => t.slug).filter(Boolean)
      const should = m.lane !== 'lead' && slugs.some((s) => muted.has(s))
      const is = m.topicMuted === true
      if (should === is) continue
      await strapi
        .documents('api::mention.mention')
        .update({ documentId: m.documentId, data: { topicMuted: should } as any })
      if (should) flagged += 1
      else restored += 1
    }
    strapi.log.info(`[mute-topic] rescan: ${flagged} flagged, ${restored} restored`)
    return { scanned: mentions.length, flagged, restored }
  },

  /**
   * Topics that look like noise, ranked — a suggestion, never an action.
   *
   * The signal is three-part and deliberately conservative:
   *  - almost none of it is about Strapi (`sentimentLabel: 'na'`)
   *  - almost all of it is already routed to the monitor lane
   *  - its `kind` is `competitor` or `other`
   *
   * The first two alone are not enough, and the first version of this was wrong
   * because of it: run against real data it suggested muting `Docs` and `Bugs`.
   * A topic of kind `feature` / `bug` / `docs` is about OUR product by
   * definition — a high `na` share there means the classifier mislabeled the
   * sentiment, not that the topic is noise, and muting it would hide exactly
   * the feedback Pulse exists to capture. Those kinds are never suggested.
   *
   * Evidence ids come back with every row for the same reason `laneReason` and
   * `qualityReason` exist: a judgement you cannot audit is one you cannot trust.
   * Lead count is reported as context, not as a veto — muting exempts the lead
   * lane, so accepting a suggestion can never cost a lead.
   */
  async suggestions({ days = 30, minMentions = 20 }: { days?: number; minMentions?: number } = {}) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const alreadyMuted = await this.mutedSlugs()

    // Measure EXACTLY the population the theme report measures — same
    // COUNTS_AS_SIGNAL filter, same `analyzed` restriction. Anything less makes
    // the suggestion unactionable: counting rows the report already excludes
    // recommends muting volume that is not polluting anything, and an
    // unanalyzed row has no `sentimentLabel` at all, so counting it would
    // silently dilute naShare toward zero.
    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { ...COUNTS_AS_SIGNAL, analysisStatus: 'analyzed', postedAt: { $gte: since } } as any,
      fields: ['sentimentLabel', 'lane'],
      populate: { topics: { fields: ['name', 'slug', 'kind'] } } as any,
      limit: 5000,
    })

    type Stat = {
      name: string
      slug: string
      kind: string
      total: number
      na: number
      monitor: number
      leads: number
      evidence: string[]
    }
    const stats = new Map<string, Stat>()
    for (const m of mentions as any[]) {
      for (const t of m.topics ?? []) {
        if (!t?.slug || alreadyMuted.has(t.slug)) continue
        let s = stats.get(t.slug)
        if (!s) {
          s = { name: t.name, slug: t.slug, kind: t.kind, total: 0, na: 0, monitor: 0, leads: 0, evidence: [] }
          stats.set(t.slug, s)
        }
        s.total += 1
        if (m.lane === 'lead') {
          // Counted, then excluded from every numerator: leads are exempt from
          // muting, so including them would measure a population the mute will
          // never touch — and an `na` lead would push naShare above 1 once the
          // denominator drops them.
          s.leads += 1
          continue
        }
        if (m.sentimentLabel === 'na') s.na += 1
        if (m.lane === 'monitor') s.monitor += 1
        // evidence is drawn only from mentions the mute would actually hide
        if (s.evidence.length < 10) s.evidence.push(m.documentId)
      }
    }

    // 'other' is included because intake's fallback kind is 'other' and most
    // competitor terms land there; the product kinds are the ones that must
    // never be suggested.
    const MUTABLE_KINDS = ['competitor', 'other']

    // Both shares are measured over `affected` — the non-lead mentions, the
    // only ones muting would actually hide — not over the topic's whole volume.
    // Measuring over the total was wrong in the exact case this feature exists
    // for: "Competitor" is 99% not-about-Strapi across 599 mentions, but 155 of
    // them are leads, which dragged monitorShare to 0.74 and suppressed the
    // suggestion. A topic was being spared because it produces the leads the
    // mute would never touch. `mentions` still reports the full volume so the
    // number lines up with the theme report.
    const suggestions = [...stats.values()]
      .filter((s) => s.total >= minMentions && MUTABLE_KINDS.includes(s.kind))
      .map((s) => {
        const affected = s.total - s.leads
        return {
          ...s,
          affected,
          naShare: affected ? s.na / affected : 0,
          monitorShare: affected ? s.monitor / affected : 0,
        }
      })
      .filter((s) => s.affected > 0 && s.naShare >= 0.8 && s.monitorShare >= 0.9)
      .map((s) => ({
        topic: { name: s.name, slug: s.slug, kind: s.kind },
        mentions: s.total,
        affected: s.affected,
        naShare: Math.round(s.naShare * 100) / 100,
        monitorShare: Math.round(s.monitorShare * 100) / 100,
        leads: s.leads,
        reason:
          `${s.affected} of ${s.total} mentions would be muted — ` +
          `${Math.round(s.naShare * 100)}% of them not about Strapi, ` +
          `${Math.round(s.monitorShare * 100)}% already monitor-lane` +
          (s.leads ? `; ${s.leads} lead${s.leads === 1 ? '' : 's'} kept` : ''),
        evidence: s.evidence,
      }))
      .sort((a, b) => b.affected * b.naShare - a.affected * a.naShare)

    return { windowDays: days, minMentions, suggestions }
  },
}))
