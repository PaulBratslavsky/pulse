import type { Core } from '@strapi/strapi';

/**
 * Octolens webhook receiver (real-time half of the hybrid ingest; the sync
 * service is the primary path while Octolens' URL validator is broken).
 * Rules: shared secret via ?secret= or x-pulse-secret header (auth:false
 * route, NOT a Public permission); return fast (no AI in-request); dedupe on
 * externalId; malformed payloads become dead letters + ops alert — never
 * dropped. Exposed at POST /api/octolens/ingest.
 */

function normalize(payload: any) {
  // Webhooks wrap the mention: { action: 'mention_created', data: {...} }
  // (octolens.com/docs/quickstart/webhooks). The pull API returns it flat.
  const m = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const externalId = m.sourceId ?? m.id ?? m.externalId ?? m.external_id ?? m.mention?.id ?? null;
  const content = m.body ?? m.text ?? m.content ?? m.mention?.text ?? m.title ?? null;
  if (!externalId || !content) {
    throw new Error(`missing required fields (externalId: ${!!externalId}, content: ${!!content})`);
  }
  return {
    externalId: String(externalId),
    content: String(content),
    authorHandle: m.author?.handle ?? m.author ?? m.authorHandle ?? m.author_name ?? null,
    url: m.url ?? m.link ?? m.permalink ?? null,
    postedAt: m.postedAt ?? m.timestamp ?? m.created_at ?? m.createdAt ?? null,
    platformKey: String(m.platform ?? m.source ?? m.channel ?? 'unknown').toLowerCase(),
  };
}

export const webhook = ({ strapi }: { strapi: Core.Strapi }) => ({
  async receive(ctx: any) {
    const secret = process.env.OCTOLENS_WEBHOOK_SECRET;
    const provided = ctx.request.headers['x-pulse-secret'] ?? ctx.query?.secret;
    if (!secret || provided !== secret) {
      strapi.log.warn('[octolens] webhook rejected: bad or missing secret (header or ?secret=)');
      return ctx.unauthorized('bad secret');
    }

    const payload = ctx.request.body ?? {};
    const intake = strapi.plugin('octolens').service('intake') as any;
    let normalized;
    try {
      normalized = normalize(payload);
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

    normalized.postedAt = intake.parseTimestamp(normalized.postedAt);
    const result = await intake.upsertMention(normalized, payload, 'webhook');
    ctx.body = result.created
      ? { ok: true, documentId: result.documentId }
      : { duplicate: true, documentId: result.documentId };
  },
});

export default webhook;
