import type { Core } from '@strapi/strapi';
import { aiEnabled } from '../../analysis/services/ai';

/**
 * Shared mention-intake path — used by BOTH the Octolens webhook (real-time)
 * and the pull-sync (reconciliation). One dedupe, one channel mapping, one
 * activity trail, regardless of how a mention arrives.
 *
 * Sentiment provenance (user decision, 2026-07-27): while Pulse AI is DISABLED,
 * Octolens' own per-mention sentiment is used as the initial label — stamped
 * `modelVersion: 'octolens'` (coarse score mapping: positive +0.5 / neutral 0 /
 * negative −0.5, since Octolens ships a label, not a number). When Pulse AI is
 * enabled, Octolens sentiment is ignored (kept in `raw`) and Pulse analyzes.
 * Human corrections always win; enabling AI later never silently re-scores
 * octolens-labeled history (bulk replay is an explicit action).
 */

const OCTOLENS_SCORE: Record<string, number> = { positive: 0.5, neutral: 0, negative: -0.5 };

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

  /** Octolens payloads carry sentiment as "Positive"/"Neutral"/"Negative". */
  octolensSentiment(raw: any): { label: string; score: number } | null {
    const label = String(raw?.sentiment ?? '').toLowerCase();
    if (!(label in OCTOLENS_SCORE)) return null;
    return { label, score: OCTOLENS_SCORE[label] };
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

    // Keyless mode: adopt Octolens' sentiment as the initial, provenance-stamped label.
    const octolens = !aiEnabled() ? this.octolensSentiment(raw) : null;

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
        ...(octolens
          ? {
              analysisStatus: 'analyzed',
              sentimentLabel: octolens.label,
              sentimentScore: octolens.score,
              modelVersion: 'octolens',
              promptVersion: 'label-map-v1',
            }
          : { analysisStatus: 'pending' }),
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
    if (octolens) {
      await strapi.documents('api::activity.activity').create({
        data: {
          mention: mention.documentId,
          action: 'analyzed',
          detail: { modelVersion: 'octolens', label: octolens.label },
          at: new Date().toISOString(),
        } as any,
      });
      // already labeled — the sweep will never see this mention, so notify here
      await (strapi.service('api::notify.slack') as any)
        .newMention({ ...mention, sentimentLabel: octolens.label })
        .catch(() => {});
    }
    return { created: true, documentId: mention.documentId, octolensLabeled: Boolean(octolens) };
  },
});

export default intake;
