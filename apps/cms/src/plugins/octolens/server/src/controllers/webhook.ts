import { timingSafeEqual } from 'node:crypto';
import type { Core } from '@strapi/strapi';

/**
 * Octolens webhook receiver (real-time half of the hybrid ingest; the sync
 * service is the primary path while Octolens' URL validator is broken).
 * Rules: shared secret via ?secret= or x-pulse-secret header (auth:false
 * route, NOT a Public permission); return fast (no AI in-request); dedupe on
 * externalId; malformed payloads become dead letters + ops alert — never
 * dropped. Exposed at POST /api/octolens/ingest.
 */

/** constant-time secret compare (equal-length buffers required by the API) */
function secretMatches(provided: unknown, secret: string): boolean {
  if (typeof provided !== 'string' || provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

export const webhook = ({ strapi }: { strapi: Core.Strapi }) => ({
  async receive(ctx: any) {
    const secret = process.env.OCTOLENS_WEBHOOK_SECRET;
    const provided = ctx.request.headers['x-pulse-secret'] ?? ctx.query?.secret;
    // Octolens' webhook form only takes a URL, so ?secret= must stay supported —
    // but strapi::logger prints ctx.url per request, which would write the
    // secret into (retained) access logs on EVERY delivery. Redact it before
    // the logger's post-await runs (routing already happened; mutation is safe).
    if (typeof ctx.query?.secret === 'string' && ctx.url.includes('secret=')) {
      ctx.url = ctx.url.replace(/secret=[^&]*/, 'secret=REDACTED');
    }
    if (!secret || !secretMatches(provided, secret)) {
      strapi.log.warn('[octolens] webhook rejected: bad or missing secret (header or ?secret=)');
      return ctx.unauthorized('bad secret');
    }

    const payload = ctx.request.body ?? {};
    const intake = strapi.plugin('octolens').service('intake') as any;
    let normalized;
    try {
      normalized = intake.normalizePayload(payload);
    } catch (err: any) {
      await strapi.documents('api::dead-letter.dead-letter').create({
        data: { raw: payload, error: err.message, receivedAt: new Date().toISOString() } as any,
      });
      await (strapi.service('api::notify.slack') as any)
        .ops(`octolens dead-letter: ${err.message}`)
        .catch(() => {});
      ctx.status = 202;
      ctx.body = { deadLettered: true };
      return;
    }

    let result;
    try {
      result = await intake.upsertMention(normalized, payload, 'webhook');
    } catch (err: any) {
      // Saving failed (database, a relation, a bug) — keep the delivery as a
      // dead letter so it can be replayed, rather than lose it. If even that
      // write fails, answer 500 so the sender can try again.
      strapi.log.error(`[octolens] webhook intake failed, dead-lettering: ${err.message}`);
      try {
        await strapi.documents('api::dead-letter.dead-letter').create({
          data: { raw: payload, error: `intake: ${err.message}`, receivedAt: new Date().toISOString() } as any,
        });
      } catch (dlErr: any) {
        strapi.log.error(`[octolens] dead-letter write failed too: ${dlErr.message}`);
        ctx.status = 500;
        ctx.body = { error: 'intake failed' };
        return;
      }
      await (strapi.service('api::notify.slack') as any)
        .ops(`octolens webhook intake failed (dead-lettered for replay): ${err.message}`)
        .catch(() => {});
      ctx.status = 202;
      ctx.body = { deadLettered: true };
      return;
    }
    ctx.body = result.created
      ? { ok: true, documentId: result.documentId }
      : { duplicate: true, documentId: result.documentId };
  },
});

export default webhook;
