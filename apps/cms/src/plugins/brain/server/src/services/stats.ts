import type { Core } from '@strapi/strapi';

import { UID } from '../content-types';
import {
  addDays,
  delta,
  median,
  toCount,
  utcDay,
  viewsAtMilestones,
  viewsPerDay,
  type ViewSnapshot,
} from '../utils/youtube-math';

/**
 * Read side of the brain's YouTube data: what the brain-youtube-* and
 * brain-video-results tools return. Every number is computed from stored
 * snapshots; nothing here calls YouTube.
 *
 * Counts are bigintegers, which Postgres hands back as strings and SQLite as
 * numbers, so every count goes through toCount on the way out.
 */

const docs = (strapi: Core.Strapi, uid: string) => strapi.documents(uid as any) as any;

const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export const stats = ({ strapi }: { strapi: Core.Strapi }) => ({
  /** A channel by handle ("@Strapi", case-insensitive, @ optional), YouTube id, or documentId. */
  async findChannel(ref: string) {
    const raw = String(ref ?? '').trim();
    const handle = raw.startsWith('@') ? raw : `@${raw}`;
    return docs(strapi, UID.channel).findFirst({
      filters: {
        $or: [{ handle: { $eqi: handle } }, { youtubeChannelId: raw }, { documentId: raw }],
      },
    });
  },

  /** Latest stored views for each video documentId: { views, takenOn }. */
  async latestViews(videoDocumentIds: string[]) {
    const out = new Map<string, { views: number | null; takenOn: string }>();
    // one small query per video: "latest row per group" is not expressible
    // through the Document Service, and a channel's list is at most a few hundred
    for (let i = 0; i < videoDocumentIds.length; i += 25) {
      const chunk = videoDocumentIds.slice(i, i + 25);
      const rows = await Promise.all(
        chunk.map((id) =>
          docs(strapi, UID.videoSnapshot).findFirst({
            filters: { video: { documentId: id } },
            fields: ['takenOn', 'views'],
            sort: 'takenOn:desc',
          })
        )
      );
      rows.forEach((row: any, j: number) => {
        if (row) out.set(chunk[j], { views: toCount(row.views), takenOn: row.takenOn });
      });
    }
    return out;
  },

  /** The channel snapshot on `day`, else the nearest one before it. */
  async channelSnapshotOnOrBefore(channelDocumentId: string, day: string) {
    return docs(strapi, UID.channelSnapshot).findFirst({
      filters: { channel: { documentId: channelDocumentId }, takenOn: { $lte: day } },
      sort: 'takenOn:desc',
    });
  },

  /** brain-youtube-channels */
  async channels({ days = 30 }: { days?: number } = {}) {
    const today = utcDay();
    const since = addDays(today, -days);
    const rows: any[] = await docs(strapi, UID.channel).findMany({ filters: { active: true }, limit: 500 });
    // ours first, then by handle ignoring case (SQL would put "@Strapi" before "@contentfulinc")
    const rank = (c: any) => (c.kind === 'own' ? 0 : 1);
    const channels = rows.sort(
      (a, b) => rank(a) - rank(b) || String(a.handle).toLowerCase().localeCompare(String(b.handle).toLowerCase())
    );

    const out = [];
    for (const ch of channels) {
      const latest: any = await this.channelSnapshotOnOrBefore(ch.documentId, today);
      const baseline: any = await this.channelSnapshotOnOrBefore(ch.documentId, since);
      const earliest: any = baseline
        ? null
        : await docs(strapi, UID.channelSnapshot).findFirst({
            filters: { channel: { documentId: ch.documentId } },
            fields: ['takenOn'],
            sort: 'takenOn:asc',
          });

      const [longInWindow, shortsInWindow] = await Promise.all(
        [false, true].map((isShort) =>
          docs(strapi, UID.video).count({
            filters: { channel: { documentId: ch.documentId }, isShort, postedAt: { $gte: `${since}T00:00:00.000Z` } },
          })
        )
      );

      const lastLong: any[] = await docs(strapi, UID.video).findMany({
        filters: { channel: { documentId: ch.documentId }, isShort: false, durationSeconds: { $gt: 0 } },
        fields: ['youtubeVideoId', 'postedAt'],
        sort: 'postedAt:desc',
        limit: 10,
      });
      const lastLongViews = await this.latestViews(lastLong.map((v) => v.documentId));

      const cur = latest
        ? {
            takenOn: latest.takenOn,
            subscribers: toCount(latest.subscribers),
            totalViews: toCount(latest.totalViews),
            videoCount: toCount(latest.videoCount),
          }
        : null;
      const base = baseline
        ? {
            takenOn: baseline.takenOn,
            subscribers: toCount(baseline.subscribers),
            totalViews: toCount(baseline.totalViews),
            videoCount: toCount(baseline.videoCount),
          }
        : null;

      out.push({
        handle: ch.handle,
        title: ch.title ?? null,
        kind: ch.kind,
        youtubeChannelId: ch.youtubeChannelId ?? null,
        latest: cur,
        baseline: base,
        // null when there is no snapshot that old yet — history starts at historyStartsOn
        ...(base ? {} : { historyStartsOn: earliest?.takenOn ?? null }),
        deltas: {
          subscribers: delta(cur?.subscribers, base?.subscribers),
          totalViews: delta(cur?.totalViews, base?.totalViews),
        },
        publishedInWindow: { long: longInWindow, shorts: shortsInWindow },
        medianViewsLast10Long: median(lastLong.map((v) => lastLongViews.get(v.documentId)?.views)),
        longVideosInMedian: lastLong.filter((v) => lastLongViews.get(v.documentId)?.views != null).length,
      });
    }
    return { days, since, today, channels: out };
  },

  /** brain-youtube-videos */
  async videos(args: { channel: string; since?: string; shorts?: 'yes' | 'no'; topic?: string; limit?: number }) {
    const ch: any = await this.findChannel(args.channel);
    if (!ch) return { error: `no tracked channel "${args.channel}" — brain-youtube-channels lists them` };
    const limit = args.limit ?? 50;
    const filters: any = {
      channel: { documentId: ch.documentId },
      ...(args.since ? { postedAt: { $gte: new Date(args.since).toISOString() } } : {}),
      ...(args.shorts === 'yes' ? { isShort: true } : {}),
      ...(args.shorts === 'no' ? { isShort: false } : {}),
      ...(args.topic ? { topic: { $eqi: args.topic } } : {}),
    };
    const [rows, total] = await Promise.all([
      docs(strapi, UID.video).findMany({ filters, sort: 'postedAt:desc', limit }),
      docs(strapi, UID.video).count({ filters }),
    ]);
    const latest = await this.latestViews((rows as any[]).map((v) => v.documentId));
    return {
      channel: ch.handle,
      total,
      returned: rows.length,
      videos: (rows as any[]).map((v) => {
        const l = latest.get(v.documentId);
        return {
          youtubeVideoId: v.youtubeVideoId,
          title: v.title,
          url: videoUrl(v.youtubeVideoId),
          postedAt: v.postedAt,
          durationSeconds: v.durationSeconds,
          isShort: Boolean(v.isShort),
          topic: v.topic ?? null,
          views: l?.views ?? null,
          viewsTakenOn: l?.takenOn ?? null,
          viewsPerDay: l && v.postedAt ? viewsPerDay(l.views, v.postedAt, l.takenOn) : null,
        };
      }),
    };
  },

  /** Every snapshot of one video, oldest first. */
  async videoSnapshots(videoDocumentId: string): Promise<ViewSnapshot[]> {
    const rows: any[] = await docs(strapi, UID.videoSnapshot).findMany({
      filters: { video: { documentId: videoDocumentId } },
      fields: ['takenOn', 'views'],
      sort: 'takenOn:asc',
      limit: 1000,
    });
    return rows.map((r) => ({ takenOn: r.takenOn, views: toCount(r.views) }));
  },

  /** brain-video-results */
  async videoResults({ video }: { video: string }) {
    const id = String(video ?? '').trim();
    const v: any = await docs(strapi, UID.video).findFirst({
      filters: { $or: [{ youtubeVideoId: id }, { documentId: id }] },
      populate: { channel: { fields: ['handle', 'title'] } },
    });
    if (!v) return { error: `no stored video "${video}" — use the 11-character YouTube id` };
    const today = utcDay();
    const milestones = v.postedAt ? viewsAtMilestones(v.postedAt, await this.videoSnapshots(v.documentId), today) : [];

    // Compare like with like: same channel, same topic, same format (a Short's
    // numbers say nothing about a long video's).
    let topicMedian: any = null;
    if (v.topic && v.channel) {
      const peers: any[] = await docs(strapi, UID.video).findMany({
        filters: {
          channel: { documentId: v.channel.documentId },
          topic: { $eqi: v.topic },
          isShort: Boolean(v.isShort),
          documentId: { $ne: v.documentId },
        },
        fields: ['postedAt'],
        limit: 200,
      });
      const peerMilestones = await Promise.all(
        peers
          .filter((p) => p.postedAt)
          .map(async (p) => viewsAtMilestones(p.postedAt, await this.videoSnapshots(p.documentId), today))
      );
      topicMedian = {
        topic: v.topic,
        peers: peers.length,
        byDay: milestones.map((m, i) => {
          const values = peerMilestones.map((pm) => pm[i]?.views);
          return { day: m.day, medianViews: median(values), videosWithData: values.filter((x) => x != null).length };
        }),
      };
    }

    return {
      video: {
        youtubeVideoId: v.youtubeVideoId,
        title: v.title,
        url: videoUrl(v.youtubeVideoId),
        channel: v.channel?.handle ?? null,
        postedAt: v.postedAt,
        isShort: Boolean(v.isShort),
        topic: v.topic ?? null,
      },
      milestones,
      // null when the video has no topic: set one in the Content Manager to compare
      topicMedian,
    };
  },
});

export default stats;
