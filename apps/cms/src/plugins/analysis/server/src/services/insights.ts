import type { Core } from '@strapi/strapi';

/**
 * The Pulse score — single source of truth (build spec):
 * per UTC day, volume-weighted mean of sentimentScore over a trailing 7-day
 * window, scaled 0–100: (mean + 1) * 50. Aggregated in JS (portable across
 * SQLite dev / Postgres prod; fine at assumed volumes — revisit at 10×).
 * Consumed by: insights API, MCP tools, assistant, Slack stale digest —
 * always via strapi.plugin('analysis').service('insights').
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

  async stale(opts: { days?: number } = {}) {
    const days = opts.days ?? Number(process.env.STALE_AFTER_DAYS ?? 2);
    const cutoff = new Date(Date.now() - days * DAY).toISOString();
    const mentions = await strapi.documents('api::mention.mention').findMany({
      filters: { status: { $in: ['unanswered', 'claimed'] }, receivedAt: { $lte: cutoff } },
      fields: ['content', 'status', 'sentimentLabel', 'receivedAt', 'url'],
      populate: { owner: { fields: ['username'] }, channel: { fields: ['name'] } } as any,
      sort: 'receivedAt:asc' as any,
      limit: 100,
    });
    return { staleAfterDays: days, mentions };
  },
});
