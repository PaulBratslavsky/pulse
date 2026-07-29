import type { Core } from '@strapi/strapi';

/**
 * The Pulse score — single source of truth (build spec):
 * per UTC day, volume-weighted mean of sentimentScore over a trailing 7-day
 * window, scaled 0–100: (mean + 1) * 50. Aggregated in JS (portable across
 * SQLite dev / Postgres prod; fine at assumed volumes — revisit at 10×).
 * Consumed by: insights API, MCP tools, assistant, Slack stale digest —
 * always via strapi.service('api::analysis.insights').
 */

const DAY = 24 * 60 * 60 * 1000;
const utcDay = (d: string | Date) => new Date(d).toISOString().slice(0, 10);

/**
 * What counts as community signal. Two exclusions, for the same reason —
 * neither is someone talking about Strapi in the wild:
 *  - spam (muted authors / confirmed slop): one AI content farm would
 *    otherwise own the top topic and set the Pulse score;
 *  - our OWN social posts (acknowledged as `own-post`): announcements are
 *    positive by construction, so counting them inflates our own score.
 * Own posts stay visible in the acknowledged pile — they're excluded from the
 * numbers, not hidden from the team.
 */
const NOT_SPAM = {
  $and: [
    { $or: [{ quality: { $null: true } }, { quality: { $ne: 'spam' } }] },
    { $or: [{ acknowledgeReason: { $null: true } }, { acknowledgeReason: { $ne: 'own-post' } }] },
  ],
} as any;

export const insights = ({ strapi }: { strapi: Core.Strapi }) => ({
  async trends(opts: { from?: string; to?: string; topic?: string } = {}) {
    const toDate = opts.to ? new Date(opts.to) : new Date();
    const fromDate = opts.from ? new Date(opts.from) : new Date(toDate.getTime() - 90 * DAY);
    const windowStart = new Date(fromDate.getTime() - 7 * DAY);

    const filters: any = {
      ...NOT_SPAM,
      analysisStatus: 'analyzed',
      postedAt: { $gte: windowStart.toISOString(), $lte: toDate.toISOString() },
    };
    if (opts.topic) filters.topics = { slug: opts.topic };

    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters,
      fields: ['postedAt', 'sentimentScore'],
      limit: 5000,
    });

    const byDay = new Map<string, { sum: number; n: number }>();
    for (const m of mentions) {
      if (m.sentimentScore == null || !m.postedAt) continue;
      const day = utcDay(m.postedAt as any);
      const b = byDay.get(day) ?? { sum: 0, n: 0 };
      b.sum += Number(m.sentimentScore);
      b.n += 1;
      byDay.set(day, b);
    }

    const series: Array<{ date: string; score: number | null; volume: number }> = [];
    for (let t = fromDate.getTime(); t <= toDate.getTime(); t += DAY) {
      let sum = 0;
      let n = 0;
      for (let w = 0; w < 7; w++) {
        const b = byDay.get(utcDay(new Date(t - w * DAY)));
        if (b) {
          sum += b.sum;
          n += b.n;
        }
      }
      series.push({
        date: utcDay(new Date(t)),
        score: n ? Math.round((sum / n + 1) * 50 * 10) / 10 : null,
        volume: byDay.get(utcDay(new Date(t)))?.n ?? 0,
      });
    }

    const events = await strapi.documents('api::event.event').findMany({
      filters: { date: { $gte: fromDate.toISOString(), $lte: toDate.toISOString() } },
      fields: ['title', 'date', 'kind'],
      limit: 5000,
    });

    return { series, events };
  },

  async themes(opts: { days?: number } = {}) {
    const days = opts.days ?? 30;
    const since = new Date(Date.now() - days * DAY).toISOString();

    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { ...NOT_SPAM, analysisStatus: 'analyzed', postedAt: { $gte: since } },
      fields: ['sentimentScore', 'sentimentLabel', 'postedAt'],
      populate: { topics: { fields: ['name', 'slug', 'kind'] } } as any,
      limit: 5000,
    });

    const byTopic = new Map<string, { topic: any; count: number; negative: number; scoreSum: number; evidence: string[] }>();
    for (const m of mentions as any[]) {
      for (const t of m.topics ?? []) {
        const e = byTopic.get(t.slug) ?? { topic: t, count: 0, negative: 0, scoreSum: 0, evidence: [] };
        e.count += 1;
        if (m.sentimentLabel === 'negative') e.negative += 1;
        e.scoreSum += Number(m.sentimentScore ?? 0);
        if (e.evidence.length < 10) e.evidence.push(m.documentId);
        byTopic.set(t.slug, e);
      }
    }

    const themes = [...byTopic.values()]
      .map((e) => ({
        topic: e.topic,
        mentions: e.count,
        negativeShare: e.count ? Math.round((e.negative / e.count) * 100) : 0,
        avgScore: e.count ? Math.round((e.scoreSum / e.count) * 100) / 100 : 0,
        evidence: e.evidence,
      }))
      .sort((a, b) => b.negativeShare * b.mentions - a.negativeShare * a.mentions);

    return { windowDays: days, themes };
  },

  /** Staleness is measured from postedAt (when the comment was published on
   *  the platform), not receivedAt — synced backlog counts as already-stale. */
  async stale(opts: { days?: number } = {}) {
    const days = opts.days ?? Number(process.env.STALE_AFTER_DAYS ?? 2);
    const cutoff = new Date(Date.now() - days * DAY).toISOString();
    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { ...NOT_SPAM, status: { $in: ['unanswered', 'claimed'] }, postedAt: { $lte: cutoff } },
      fields: ['content', 'status', 'sentimentLabel', 'postedAt', 'receivedAt', 'url'],
      populate: { owner: { fields: ['username'] }, channel: { fields: ['name'] } } as any,
      sort: 'postedAt:asc' as any,
      limit: 100,
    });
    return { staleAfterDays: days, mentions };
  },

  /**
   * Product-feedback digest: every `kind: feedback` comment the team captured,
   * with the source mention for context. This is the "what should we build"
   * surface — it deliberately reads from human-captured feedback rather than
   * raw mention text, because the team's framing of a pain point is worth more
   * than a keyword match. Grouped counts by topic give the prioritisation
   * signal; archived comments and spam mentions are excluded.
   */
  async feedback(opts: { days?: number; topic?: string } = {}) {
    const days = opts.days ?? 90;
    const since = new Date(Date.now() - days * DAY).toISOString();

    const comments = await strapi.documents('api::comment.comment').findMany({
      filters: { kind: 'feedback', archived: { $ne: true }, createdAt: { $gte: since } } as any,
      fields: ['body', 'links', 'createdAt'],
      populate: {
        author: { fields: ['username'] },
        mention: {
          fields: ['content', 'url', 'sentimentLabel', 'postedAt', 'quality', 'authorHandle'],
          populate: { topics: { fields: ['name', 'slug'] }, channel: { fields: ['name'] } },
        },
      } as any,
      sort: 'createdAt:desc' as any,
      limit: 500,
    });

    const items = (comments as any[])
      .filter((c) => c.mention && c.mention.quality !== 'spam')
      .filter((c) => !opts.topic || (c.mention.topics ?? []).some((t: any) => t.slug === opts.topic))
      .map((c) => ({
        documentId: c.documentId,
        body: c.body,
        links: Array.isArray(c.links) ? c.links : [],
        capturedBy: c.author?.username ?? null,
        capturedAt: c.createdAt,
        mention: {
          documentId: c.mention.documentId,
          excerpt: String(c.mention.content ?? '').slice(0, 300),
          url: c.mention.url,
          authorHandle: c.mention.authorHandle,
          sentimentLabel: c.mention.sentimentLabel,
          channel: c.mention.channel?.name ?? null,
          topics: (c.mention.topics ?? []).map((t: any) => ({ name: t.name, slug: t.slug })),
        },
      }));

    // prioritisation signal: which topics keep coming up in captured feedback
    const byTopic = new Map<string, { name: string; slug: string; count: number }>();
    for (const i of items)
      for (const t of i.mention.topics) {
        const e = byTopic.get(t.slug) ?? { ...t, count: 0 };
        e.count += 1;
        byTopic.set(t.slug, e);
      }

    return {
      windowDays: days,
      total: items.length,
      topics: [...byTopic.values()].sort((a, b) => b.count - a.count),
      items,
    };
  },

  /**
   * Team leaderboard over a trailing window. Design constraints, in order:
   *  1. **Encouraging, not surveillance.** Only people who posted at least one
   *     reply are listed — nobody is published in last place with a zero, and
   *     a quiet week simply doesn't appear. Participation is opt-out per user
   *     (api::preference.hideFromLeaderboard).
   *  2. **Ranked by replies posted, NOT triage volume** — a board that counts
   *     acknowledges rewards mass-dismissing the queue, the opposite of what
   *     this tool exists to encourage. Triage shows as context, never rank.
   *  3. Sourced from the activity trail, so UI, bulk and MCP work all count.
   * Returns team totals too, so the headline can be collective rather than a
   * ranking of individuals.
   */
  async leaderboard(opts: { days?: number } = {}) {
    const days = opts.days ?? 7;
    const since = new Date(Date.now() - days * DAY).toISOString();

    const activities = await strapi.documents('api::activity.activity').findMany({
      filters: { at: { $gte: since } } as any,
      fields: ['action', 'at'],
      populate: { actor: { fields: ['username'] } } as any,
      limit: 10000,
    });

    const TRIAGE = new Set(['claimed', 'acknowledged', 'corrected', 'routed', 'noted', 'drafted']);
    const byUser = new Map<string, { username: string; replies: number; resolved: number; triaged: number }>();
    for (const a of activities as any[]) {
      const username = a.actor?.username;
      if (!username) continue; // system events have no actor
      const e = byUser.get(username) ?? { username, replies: 0, resolved: 0, triaged: 0 };
      if (a.action === 'answered') e.replies += 1;
      else if (a.action === 'resolved') e.resolved += 1;
      else if (TRIAGE.has(a.action)) e.triaged += 1;
      byUser.set(username, e);
    }

    // opted-out teammates never appear (their work still counts in the team total)
    const optedOut = new Set(
      (
        await strapi.documents('api::preference.preference').findMany({
          filters: { hideFromLeaderboard: true } as any,
          populate: { user: { fields: ['username'] } } as any,
          limit: 500,
        })
      ).map((p: any) => p.user?.username).filter(Boolean)
    );

    const all = [...byUser.values()];
    const team = {
      replies: all.reduce((n, u) => n + u.replies, 0),
      resolved: all.reduce((n, u) => n + u.resolved, 0),
      triaged: all.reduce((n, u) => n + u.triaged, 0),
      contributors: all.filter((u) => u.replies > 0).length,
    };

    const visible = all.filter((u) => !optedOut.has(u.username));

    // Ranked: people who posted replies (the behaviour the board exists to
    // encourage). No zero rows — nobody is published in last place.
    const leaders = visible
      .filter((u) => u.replies > 0)
      .sort((a, b) => b.replies - a.replies || b.resolved - a.resolved);

    // Unranked but named: whoever kept the queue moving. Triage is real work —
    // erasing it because it isn't a reply is exactly the discouraging outcome
    // this board must avoid.
    const helpers = visible
      .filter((u) => u.replies === 0 && u.triaged > 0)
      .sort((a, b) => b.triaged - a.triaged);

    return { windowDays: days, team, leaders, helpers };
  },

  /**
   * Insights snapshot: team-facing stats over a trailing window (7/30/90d).
   * Windowed on postedAt (consistent with staleness/queue semantics).
   */
  async snapshot(opts: { days?: number } = {}) {
    const days = [7, 30, 90].includes(Number(opts.days)) ? Number(opts.days) : 30;
    const since = new Date(Date.now() - days * DAY).toISOString();

    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { ...NOT_SPAM, postedAt: { $gte: since } },
      fields: ['sentimentLabel', 'sentimentScore', 'status', 'acknowledgeReason', 'postedAt'],
      populate: { channel: { fields: ['name'] } } as any,
      limit: 10000,
    });

    const byStatus: Record<string, number> = {};
    const bySentiment: Record<string, number> = { positive: 0, neutral: 0, negative: 0, unscored: 0 };
    const byChannel: Record<string, number> = {};
    const ackByReason: Record<string, number> = {};
    let scoreSum = 0;
    let scoreCount = 0;
    for (const m of mentions as any[]) {
      byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
      bySentiment[m.sentimentLabel ?? 'unscored'] = (bySentiment[m.sentimentLabel ?? 'unscored'] ?? 0) + 1;
      const ch = m.channel?.name ?? 'Unknown';
      byChannel[ch] = (byChannel[ch] ?? 0) + 1;
      if (m.status === 'acknowledged' && m.acknowledgeReason)
        ackByReason[m.acknowledgeReason] = (ackByReason[m.acknowledgeReason] ?? 0) + 1;
      if (typeof m.sentimentScore === 'number') {
        scoreSum += m.sentimentScore;
        scoreCount += 1;
      }
    }
    const answered = (byStatus.answered ?? 0) + (byStatus.resolved ?? 0);

    // public replies in the window: who answered, and how fast
    const responses = await strapi.documents('api::response.response').findMany({
      filters: { internal: { $ne: true }, respondedAt: { $gte: since } } as any,
      fields: ['respondedAt'],
      populate: {
        respondedBy: { fields: ['username'] },
        mention: { fields: ['postedAt'] },
      } as any,
      limit: 10000,
    });
    const byUser: Record<string, number> = {};
    const answerHours: number[] = [];
    for (const r of responses as any[]) {
      const who = r.respondedBy?.username ?? '—';
      byUser[who] = (byUser[who] ?? 0) + 1;
      if (r.mention?.postedAt && r.respondedAt) {
        const h = (new Date(r.respondedAt).getTime() - new Date(r.mention.postedAt).getTime()) / 3600000;
        if (h >= 0) answerHours.push(h);
      }
    }
    answerHours.sort((a, b) => a - b);
    const medianHoursToAnswer = answerHours.length
      ? Math.round(answerHours[Math.floor(answerHours.length / 2)] * 10) / 10
      : null;

    // Pulse score: current vs. window start (from the single trends implementation)
    const trends = await (this as any).trends({ from: since });
    const scored = trends.series.filter((p: any) => p.score != null);
    const current = scored.length ? scored[scored.length - 1].score : null;
    const first = scored.length ? scored[0].score : null;
    const delta = current != null && first != null ? Math.round((current - first) * 10) / 10 : null;

    const top = (rec: Record<string, number>) =>
      Object.entries(rec)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

    return {
      windowDays: days,
      mentions: {
        total: mentions.length,
        byStatus,
        answered,
        answeredRate: mentions.length ? Math.round((answered / mentions.length) * 100) : 0,
        bySentiment,
        avgScore: scoreCount ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
        byChannel: top(byChannel).slice(0, 6),
        acknowledgedByReason: top(ackByReason),
      },
      responses: {
        total: responses.length,
        byUser: top(byUser),
        medianHoursToAnswer,
      },
      pulse: { current, delta },
    };
  },
});

export default insights;
