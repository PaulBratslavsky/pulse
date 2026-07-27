import type { Core } from '@strapi/strapi';

/**
 * Shared mention-intake path — used by BOTH the Octolens webhook (real-time)
 * and the pull-sync (reconciliation). One dedupe, one channel mapping, one
 * activity trail, regardless of how a mention arrives.
 */

export type NormalizedMention = {
  externalId: string;
  content: string;
  authorHandle: string | null;
  url: string | null;
  postedAt: string | null;
  platformKey: string;
};

/** Octolens platform keys → Pulse channel keys. Unknown platforms get a channel auto-created. */
const PLATFORM_MAP: Record<string, string> = {
  twitter: 'x',
  x: 'x',
  reddit: 'reddit',
  reddit_comment: 'reddit',
  linkedin: 'linkedin',
  bluesky: 'bluesky',
  hackernews: 'hackernews',
  youtube: 'youtube',
};

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

export const intake = ({ strapi }: { strapi: Core.Strapi }) => ({
  /** Octolens "2026-07-27 17:31:05.000" (UTC, space-separated) → ISO. Passes ISO through. */
  parseTimestamp(value: string | null | undefined): string | null {
    if (!value) return null;
    const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  },

  async resolveChannel(platformKey: string) {
    const key = PLATFORM_MAP[platformKey] ?? platformKey;
    let channel = await strapi.documents('api::channel.channel').findFirst({ filters: { key } });
    if (!channel) {
      channel = await strapi
        .documents('api::channel.channel')
        .create({ data: { key, name: titleCase(key) } as any });
      strapi.log.info(`[ingest] auto-created channel '${key}'`);
    }
    return channel;
  },

  /**
   * Create the mention unless it already exists (dedupe on externalId).
   * Returns { created, documentId }.
   */
  async upsertMention(normalized: NormalizedMention, raw: unknown, source: 'webhook' | 'sync') {
    const existing = await strapi
      .documents('api::mention.mention')
      .findFirst({ filters: { externalId: normalized.externalId } });
    if (existing) return { created: false, documentId: existing.documentId };

    const channel = await this.resolveChannel(normalized.platformKey);
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
        raw,
      } as any,
    });
    await strapi.documents('api::activity.activity').create({
      data: {
        mention: mention.documentId,
        action: 'ingested',
        detail: { platform: normalized.platformKey, via: source },
        at: new Date().toISOString(),
      } as any,
    });
    return { created: true, documentId: mention.documentId };
  },
});

export default intake;
