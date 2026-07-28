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

export const insights = ({ strapi }: { strapi: Core.Strapi }) => ({
  async trends(opts: { from?: string; to?: string; topic?: string } = {}) {
    const toDate = opts.to ? new Date(opts.to) : new Date();
    const fromDate = opts.from ? new Date(opts.from) : new Date(toDate.getTime() - 90 * DAY);
    const windowStart = new Date(fromDate.getTime() - 7 * DAY);

    const filters: any = {
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
      filters: { analysisStatus: 'analyzed', postedAt: { $gte: since } },
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
      filters: { status: { $in: ['unanswered', 'claimed'] }, postedAt: { $lte: cutoff } },
      fields: ['content', 'status', 'sentimentLabel', 'postedAt', 'receivedAt', 'url'],
      populate: { owner: { fields: ['username'] }, channel: { fields: ['name'] } } as any,
      sort: 'postedAt:asc' as any,
      limit: 100,
    });
    return { staleAfterDays: days, mentions };
  },

  /**
   * Insights snapshot: team-facing stats over a trailing window (7/30/90d).
   * Windowed on postedAt (consistent with staleness/queue semantics).
   */
  async snapshot(opts: { days?: number } = {}) {
    const days = [7, 30, 90].includes(Number(opts.days)) ? Number(opts.days) : 30;
    const since = new Date(Date.now() - days * DAY).toISOString();

    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { postedAt: { $gte: since } },
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
