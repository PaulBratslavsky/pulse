import type { Core } from '@strapi/strapi';

/**
 * Octolens webhook receiver (real-time half of the hybrid ingest; the
 * octolens-sync service is the reconciliation half — both share the intake
 * service). Spec rules: shared-secret header (auth:false route, NOT a Public
 * permission); return fast (no AI in-request — the cron sweep analyzes);
 * dedupe on externalId (webhooks redeliver); malformed payloads become dead
 * letters + ops alert — never dropped.
 */

function normalize(payload: any) {
  const externalId =
    payload.id ?? payload.externalId ?? payload.external_id ?? payload.sourceId ?? payload.mention?.id ?? null;
  const content = payload.text ?? payload.content ?? payload.body ?? payload.mention?.text ?? payload.title ?? null;
  if (!externalId || !content) {
    throw new Error(`missing required fields (externalId: ${!!externalId}, content: ${!!content})`);
  }
  return {
    externalId: String(externalId),
    content: String(content),
    authorHandle: payload.author?.handle ?? payload.author ?? payload.authorHandle ?? payload.author_name ?? null,
    url: payload.url ?? payload.link ?? payload.permalink ?? null,
    postedAt: payload.postedAt ?? payload.timestamp ?? payload.created_at ?? payload.createdAt ?? null,
    platformKey: String(payload.platform ?? payload.source ?? payload.channel ?? 'unknown').toLowerCase(),
  };
}

export const octolens = ({ strapi }: { strapi: Core.Strapi }) => ({
  async receive(ctx: any) {
    const secret = process.env.OCTOLENS_WEBHOOK_SECRET;
    // Octolens' webhook form has no custom-header support, so the secret is
    // also accepted as ?secret=… in the URL. (Tradeoff: query strings can land
    // in intermediary logs — mitigated by using a dedicated, rotatable secret.)
    const provided = ctx.request.headers['x-pulse-secret'] ?? ctx.query?.secret;
    if (!secret || provided !== secret) {
      strapi.log.warn('[ingest] webhook rejected: bad or missing secret (header or ?secret=)');
      return ctx.unauthorized('bad secret');
    }

    const payload = ctx.request.body ?? {};
    const intakeService = strapi.service('api::ingest.intake') as any;
    let normalized;
    try {
      normalized = normalize(payload);
    } catch (err: any) {
      // dead-letter: keep the raw payload, alert ops, never drop data.
      await strapi.documents('api::dead-letter.dead-letter').create({
        data: { raw: payload, error: err.message, receivedAt: new Date().toISOString() } as any,
      });
      await (strapi.service('api::notify.slack') as any)
        .ops(`ingest dead-letter: ${err.message}`)
        .catch(() => {});
      ctx.status = 202;
      ctx.body = { deadLettered: true };
      return;
    }

    normalized.postedAt = intakeService.parseTimestamp(normalized.postedAt);
    const result = await intakeService.upsertMention(normalized, payload, 'webhook');
    ctx.body = result.created
      ? { ok: true, documentId: result.documentId }
      : { duplicate: true, documentId: result.documentId };
  },

  /** Manual pull-sync trigger (authenticated): `{ "lookbackHours": 720 }` backfills 30 days on demand. */
  async sync(ctx: any) {
    const lookbackHours = Math.min(Number(ctx.request.body?.lookbackHours ?? 24), 24 * 365);
    if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) return ctx.badRequest('invalid lookbackHours');
    const result = await (strapi.service('api::ingest.octolens-sync') as any).sync({ lookbackHours });
    ctx.body = { data: { lookbackHours, ...result } };
  },
});

export default octolens;
