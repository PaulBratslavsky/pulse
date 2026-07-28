import type { Core } from '@strapi/strapi';

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

const aiEnabled = () => Boolean(process.env.AI_API_KEY);

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

  /** Octolens sentiment: pull API field is `sentiment`, webhook field is
   *  `data.sentimentLabel` — both "Positive"/"Neutral"/"Negative". */
  octolensSentiment(raw: any): { label: string; score: number } | null {
    const value =
      raw?.sentiment ?? raw?.sentimentLabel ?? raw?.data?.sentimentLabel ?? raw?.data?.sentiment ?? '';
    const label = String(value).toLowerCase();
    if (!(label in OCTOLENS_SCORE)) return null;
    return { label, score: OCTOLENS_SCORE[label] };
  },

  /** Octolens marks competitor content with `tags: ["competitor_mention"]` and names
   *  the matched keyword (`keywords: [{keyword: "payload", keywordTag: "competitor"}]`,
   *  under `data.` in the webhook envelope). Surface each competitor as a
   *  `kind: competitor` topic so it flows through queue filters, Top topics, themes,
   *  and future insight reports — no parallel tagging system. */
  competitorTopicNames(raw: any): string[] {
    const src = raw?.data ?? raw ?? {};
    const keywords = Array.isArray(src.keywords) ? src.keywords : [];
    const names: string[] = keywords
      .filter((k: any) => k?.keywordTag === 'competitor' && k?.keyword)
      .map((k: any) => titleCase(String(k.keyword).trim()));
    const tags = Array.isArray(src.tags) ? src.tags : [];
    if (!names.length && tags.includes('competitor_mention')) names.push('Competitor');
    return [...new Set(names)];
  },

  async resolveTopics(names: string[], kind: string): Promise<string[]> {
    const ids: string[] = [];
    for (const name of names) {
      let topic = await strapi
        .documents('api::topic.topic')
        .findFirst({ filters: { name: { $eqi: name } } });
      if (!topic) {
        topic = await strapi.documents('api::topic.topic').create({ data: { name, kind } as any });
        strapi.log.info(`[ingest] auto-created ${kind} topic '${name}'`);
      }
      ids.push(topic.documentId);
    }
    return ids;
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

    // NOTE: the pre-check above is racy (concurrent cron + manual sync); the
    // DB unique index on external_id (added in app bootstrap) is the real
    // guard — a lost race throws below and we return the winner's row.

    const channel = await this.resolveChannel(normalized.platformKey);
    const competitorTopicIds = await this.resolveTopics(this.competitorTopicNames(raw), 'competitor');

    // Keyless mode: adopt Octolens' sentiment as the initial, provenance-stamped label.
    const octolens = !aiEnabled() ? this.octolensSentiment(raw) : null;

    let mention: any;
    try {
      mention = await this.createMention(normalized, raw, channel, competitorTopicIds, octolens);
    } catch (err: any) {
      // unique-index violation → another writer created it between check and insert
      const winner = await strapi
        .documents('api::mention.mention')
        .findFirst({ filters: { externalId: normalized.externalId } });
      if (winner) {
        strapi.log.info(`[ingest] duplicate race on ${normalized.externalId} — kept existing row`);
        return { created: false, documentId: winner.documentId };
      }
      throw err;
    }
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

  createMention(
    normalized: NormalizedMention,
    raw: unknown,
    channel: any,
    competitorTopicIds: string[],
    octolens: { label: string; score: number } | null
  ) {
    return strapi.documents('api::mention.mention').create({
      data: {
        externalId: normalized.externalId,
        content: normalized.content,
        authorHandle: normalized.authorHandle,
        url: normalized.url,
        postedAt: normalized.postedAt ?? new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        channel: channel?.documentId ?? null,
        ...(competitorTopicIds.length ? { topics: competitorTopicIds } : {}),
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
  },
});

export default intake;
