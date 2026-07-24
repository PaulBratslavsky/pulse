'use strict'

/**
 * ingest plugin — Octolens webhook receiver.
 * Spec rules: shared-secret header (auth:false route, NOT a Public permission);
 * return fast (no AI in-request — the cron sweep analyzes); dedupe on externalId
 * (webhooks redeliver); malformed payloads become dead letters + ops alert —
 * never dropped. Exposed at POST /api/ingest/octolens.
 */

function normalize(payload) {
  const externalId =
    payload.id ?? payload.externalId ?? payload.external_id ?? payload.mention?.id ?? null
  const content =
    payload.text ?? payload.content ?? payload.body ?? payload.mention?.text ?? null
  if (!externalId || !content) {
    throw new Error(
      `missing required fields (externalId: ${!!externalId}, content: ${!!content})`
    )
  }
  return {
    externalId: String(externalId),
    content: String(content),
    authorHandle: payload.author?.handle ?? payload.authorHandle ?? payload.author_name ?? null,
    url: payload.url ?? payload.link ?? payload.permalink ?? null,
    postedAt: payload.postedAt ?? payload.timestamp ?? payload.created_at ?? payload.createdAt ?? null,
    platformKey: String(payload.platform ?? payload.source ?? payload.channel ?? 'unknown').toLowerCase(),
  }
}

module.exports = () => ({
  routes: {
    'content-api': {
      type: 'content-api',
      routes: [
        {
          method: 'POST',
          path: '/octolens',
          handler: 'octolens.receive',
          config: { auth: false, policies: [] },
        },
      ],
    },
  },

  controllers: {
    octolens: ({ strapi }) => ({
      async receive(ctx) {
        const secret = process.env.OCTOLENS_WEBHOOK_SECRET
        if (!secret || ctx.request.headers['x-pulse-secret'] !== secret) {
          strapi.log.warn('[ingest] webhook rejected: bad or missing x-pulse-secret')
          return ctx.unauthorized('bad secret')
        }

        const payload = ctx.request.body ?? {}
        let normalized
        try {
          normalized = normalize(payload)
        } catch (err) {
          // dead-letter: keep the raw payload, alert ops, never drop data.
          await strapi.documents('api::dead-letter.dead-letter').create({
            data: { raw: payload, error: err.message, receivedAt: new Date().toISOString() },
          })
          await strapi
            .plugin('notify')
            .service('slack')
            .ops(`ingest dead-letter: ${err.message}`)
            .catch(() => {})
          ctx.status = 202
          ctx.body = { deadLettered: true }
          return
        }

        const existing = await strapi
          .documents('api::mention.mention')
          .findFirst({ filters: { externalId: normalized.externalId } })
        if (existing) {
          ctx.body = { duplicate: true, documentId: existing.documentId }
          return
        }

        const channel = await strapi
          .documents('api::channel.channel')
          .findFirst({ filters: { key: normalized.platformKey } })

        const mention = await strapi.documents('api::mention.mention').create({
          data: {
            externalId: normalized.externalId,
            content: normalized.content,
            authorHandle: normalized.authorHandle,
            url: normalized.url,
            postedAt: normalized.postedAt ?? new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            channel: channel?.documentId ?? null,
            status: 'unanswered',
            analysisStatus: 'pending',
            raw: payload,
          },
        })
        await strapi.documents('api::activity.activity').create({
          data: {
            mention: mention.documentId,
            action: 'ingested',
            detail: { platform: normalized.platformKey },
            at: new Date().toISOString(),
          },
        })
        ctx.body = { ok: true, documentId: mention.documentId }
      },
    }),
  },
})
