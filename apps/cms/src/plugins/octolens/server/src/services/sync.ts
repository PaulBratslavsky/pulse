import { createHash } from 'node:crypto';
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

/** overlap guard: the 5-min cron and a manual "Sync now" must never run
 *  concurrently — that race is how duplicate mentions were created. */
let syncRunning = false;

const itemKey = (m: any) =>
  createHash('sha1').update(String(m?.sourceId ?? JSON.stringify(m))).digest('hex').slice(0, 16);

export const sync = ({ strapi }: { strapi: Core.Strapi }) => ({
  enabled: () => Boolean(apiKey()),

  /** Dead-letter once per item: the cron re-walks the same window every 5 min,
   *  so an unresolved dead letter with this item's key means it's already
   *  recorded — do NOT create a duplicate row per run. */
  async deadLetterOnce(m: any, message: string) {
    const key = `sync:${itemKey(m)}`;
    try {
      const existing = await strapi.documents('api::dead-letter.dead-letter').findFirst({
        filters: { error: { $startsWith: key }, resolved: false } as any,
      });
      if (existing) return false;
      await strapi.documents('api::dead-letter.dead-letter').create({
        data: { raw: m, error: `${key}: ${message}`, receivedAt: new Date().toISOString() } as any,
      });
      return true;
    } catch (err: any) {
      strapi.log.error(`[octolens-sync] dead-letter write failed: ${err.message}`);
      return false;
    }
  },

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
      return { created: 0, seen: 0, skippedIrrelevant: 0, failed: 0, pages: 0, createdItems: [], truncated: false };
    }
    if (syncRunning) {
      strapi.log.info('[octolens-sync] skipped — another sync is already running');
      return { created: 0, seen: 0, skippedIrrelevant: 0, failed: 0, pages: 0, createdItems: [], truncated: false, skippedOverlap: true };
    }
    syncRunning = true;
    try {
      return await this.runSync({ lookbackHours });
    } finally {
      syncRunning = false;
    }
  },

  async runSync({ lookbackHours = 24 }: { lookbackHours?: number } = {}) {
    const intakeService = strapi.plugin('octolens').service('intake') as any;
    const cutoff = Date.now() - lookbackHours * 3600_000;
    let cursor: string | undefined;
    let created = 0;
    let seen = 0;
    let skippedIrrelevant = 0;
    let failed = 0;
    const failedSamples: string[] = [];
    let pages = 0;
    let reachedCutoff = false;
    let cursorExhausted = false;
    const createdItems: Array<{ documentId: string; excerpt: string; platform: string; sentiment: string | null }> = [];

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
        if (!m.sourceId || !content) {
          // malformed pull-API item — record it (once) instead of dropping it forever
          failed += 1;
          await this.deadLetterOnce(m, 'item missing sourceId or body/title');
          continue;
        }
        // per-mention isolation: one bad item must never abort the run — the
        // newest-first walk restarts each run, so an unhandled throw here turns
        // a single poison mention into a permanent block on everything older.
        let result: any;
        try {
          result = await intakeService.upsertMention(
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
        } catch (err: any) {
          failed += 1;
          strapi.log.error(`[octolens-sync] upsert failed for ${m.sourceId}: ${err.message}`);
          const isNew = await this.deadLetterOnce(m, err.message);
          if (isNew && failedSamples.length < 5) failedSamples.push(`${m.sourceId}: ${err.message}`);
          continue;
        }
        if (result.created) {
          created += 1;
          if (createdItems.length < 50) {
            createdItems.push({
              documentId: result.documentId,
              excerpt: String(content).slice(0, 140),
              platform: String(m.source || 'unknown').toLowerCase(),
              sentiment: m.sentiment ?? m.sentimentLabel ?? null,
            });
          }
        }
      }
      cursor = page.pagination?.nextCursor;
      if (!cursor || (page.data ?? []).length === 0) {
        cursorExhausted = true;
        break;
      }
    }

    if (failed > 0 && failedSamples.length > 0) {
      await (strapi.service('api::notify.slack') as any)
        .ops(`octolens sync: ${failed} item(s) failed intake this run (new failures dead-lettered). First: ${failedSamples.join(' | ')}`)
        .catch(() => {});
    }

    // hard-stop hit before reaching the lookback cutoff = the window's tail was
    // NOT walked (and cron re-runs hit the same newest-first cap, so the tail
    // is NOT recovered automatically) — backfills/outage recovery must re-run
    // with a shorter lookback per slice. Say it loudly.
    const truncated = !reachedCutoff && !cursorExhausted && pages >= MAX_PAGES;
    if (truncated) {
      strapi.log.warn(`[octolens-sync] TRUNCATED at ${pages} pages before the ${lookbackHours}h cutoff`);
      await (strapi.service('api::notify.slack') as any)
        .ops(`octolens sync truncated at ${pages} pages (${seen} seen) before covering the ${lookbackHours}h window — re-run with a shorter lookback per slice`)
        .catch(() => {});
    }

    strapi.log.info(
      `[octolens-sync] ${created} new / ${seen} seen (${skippedIrrelevant} irrelevant skipped, ${failed} failed, ${pages} page(s), lookback ${lookbackHours}h${truncated ? ', TRUNCATED' : ''})`
    );
    return { created, seen, skippedIrrelevant, failed, pages, createdItems, truncated };
  },
});

export default sync;
