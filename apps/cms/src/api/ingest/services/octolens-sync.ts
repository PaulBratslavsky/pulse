import type { Core } from '@strapi/strapi';

/**
 * Octolens pull-sync — the reconciliation half of the hybrid ingest design
 * (webhook = real-time; this sweep catches anything the webhook missed).
 *
 * API mechanics (verified live against api/v2, 2026-07-27):
 * - POST /api/v2/mentions  body: { limit, cursor? } → { data: [...], pagination: { nextCursor } }
 * - Pages walk newest → oldest; cursor encodes timestamp+sourceId. Date-range
 *   body params are NOT honored — we walk pages until `timestamp` passes the
 *   lookback cutoff.
 * - Mention fields used: sourceId (→ externalId), body/title, author, url,
 *   source (platform), timestamp. Everything else (sentiment, relevance,
 *   tags, keywords, engaged, …) is preserved in `raw`.
 * - Mentions Octolens marked irrelevant are skipped.
 */

const API_BASE = 'https://app.octolens.com/api/v2';
const PAGE_SIZE = 50;
const MAX_PAGES = 40; // hard stop: 2000 mentions per run

const apiKey = () => process.env.OCTOLENS_API_KEY || process.env.OCTOLENS_API || '';

export const octolensSync = ({ strapi }: { strapi: Core.Strapi }) => ({
  enabled: () => Boolean(apiKey()),

  async fetchPage(cursor?: string) {
    const res = await fetch(`${API_BASE}/mentions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }),
    });
    if (!res.ok) throw new Error(`octolens ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as { data: any[]; pagination?: { nextCursor?: string } };
  },

  /**
   * Walk pages newest→oldest until the lookback cutoff; upsert everything.
   * Idempotent (dedupe on sourceId). Returns counts for logging/ops.
   */
  async sync({ lookbackHours = 24 }: { lookbackHours?: number } = {}) {
    if (!this.enabled()) {
      strapi.log.info('[octolens-sync] skipped — no OCTOLENS_API key configured');
      return { created: 0, seen: 0, skippedIrrelevant: 0, pages: 0 };
    }
    const intakeService = strapi.service('api::ingest.intake') as any;
    const cutoff = Date.now() - lookbackHours * 3600_000;
    let cursor: string | undefined;
    let created = 0;
    let seen = 0;
    let skippedIrrelevant = 0;
    let pages = 0;
    let reachedCutoff = false;

    while (!reachedCutoff && pages < MAX_PAGES) {
      const page = await this.fetchPage(cursor);
      pages += 1;
      for (const m of page.data ?? []) {
        const postedAt = intakeService.parseTimestamp(m.timestamp);
        if (postedAt && new Date(postedAt).getTime() < cutoff) {
          reachedCutoff = true;
          break;
        }
        seen += 1;
        if (m.relevance === 'irrelevant') {
          skippedIrrelevant += 1;
          continue;
        }
        const content = m.body || m.title;
        if (!m.sourceId || !content) continue;
        const result = await intakeService.upsertMention(
          {
            externalId: String(m.sourceId),
            content: String(content),
            authorHandle: m.author || m.authorName || null,
            url: m.url || null,
            postedAt,
            platformKey: String(m.source || 'unknown').toLowerCase(),
          },
          m,
          'sync'
        );
        if (result.created) created += 1;
      }
      cursor = page.pagination?.nextCursor;
      if (!cursor || (page.data ?? []).length === 0) break;
    }

    strapi.log.info(
      `[octolens-sync] ${created} new / ${seen} seen (${skippedIrrelevant} irrelevant skipped, ${pages} page(s), lookback ${lookbackHours}h)`
    );
    return { created, seen, skippedIrrelevant, pages };
  },
});

export default octolensSync;
