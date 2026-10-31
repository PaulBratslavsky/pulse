import type { Core } from '@strapi/strapi';

import { UID } from '../content-types';
import { isShortVideo, parseIsoDuration, toCount, utcDay } from '../utils/youtube-math';

/**
 * YouTube Data API v3 sync — public numbers for every active channel, once a day.
 *
 * Per channel (quota in brackets; the API's default budget is 10,000 a day):
 * - channels.list snippet,statistics,contentDetails, by id or else forHandle [1]
 * - playlistItems.list over the uploads playlist, 50 a page, newest first, up
 *   to `uploadsLimit` (default 100) [1 a page]
 * - videos.list snippet,statistics,contentDetails, 50 ids a call [1 a call]
 * So ~3 units a channel plus 2 per extra 50 uploads: seven channels at the
 * default limit is ~35 units.
 *
 * The key travels in the x-goog-api-key header, never the query string, so it
 * cannot end up in a URL, an error message or a log line. Nothing here returns it.
 *
 * Idempotent: a second run on the same UTC day updates that day's snapshots
 * rather than adding rows (dayKey, unique-indexed).
 */

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const PAGE_SIZE = 50;
const DEFAULT_UPLOADS_LIMIT = 100;

const apiKey = () => process.env.YOUTUBE_API_KEY || '';

/** cron and the on-demand route must never run at the same time */
let syncRunning = false;

class YouTubeError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string
  ) {
    super(message);
  }
}

export type ChannelResult = {
  handle: string;
  ok: boolean;
  videos: number;
  error?: string;
  /** set when the uploads playlist is hidden or gone: the channel snapshot is still taken */
  uploadsUnavailable?: boolean;
};

export const youtube = ({ strapi }: { strapi: Core.Strapi }) => ({
  enabled: () => Boolean(apiKey()),

  /** One GET; quota is counted by the caller. Errors carry YouTube's reason, never the request. */
  async get(path: string, params: Record<string, string | number | undefined>) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const res = await fetch(`${API_BASE}/${path}?${qs}`, {
      headers: { 'x-goog-api-key': apiKey(), accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      let reason = 'unknown';
      let message = `HTTP ${res.status}`;
      try {
        const body: any = await res.json();
        reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? reason;
        message = String(body?.error?.message ?? message).slice(0, 200);
      } catch {
        // not JSON: the status is all there is
      }
      throw new YouTubeError(res.status, reason, `youtube ${path} ${res.status} ${reason}: ${message}`);
    }
    return (await res.json()) as any;
  },

  /**
   * Seed the channels Paul named for phase 1, only into an empty table, so a
   * channel someone deletes or deactivates stays that way.
   */
  async seedChannels() {
    const count = await strapi.documents(UID.channel as any).count({});
    if (count > 0) return 0;
    const seeds: Array<{ handle: string; kind: 'own' | 'competitor' }> = [
      { handle: '@Strapi', kind: 'own' },
      { handle: '@contentfulinc', kind: 'competitor' },
      { handle: '@sanity_io', kind: 'competitor' },
      { handle: '@payloadcms', kind: 'competitor' },
      { handle: '@DirectusVideos', kind: 'competitor' },
      { handle: '@storyblok-com', kind: 'competitor' },
      { handle: '@hygraph', kind: 'competitor' },
    ];
    for (const seed of seeds) {
      await strapi.documents(UID.channel as any).create({ data: { ...seed, active: true } as any });
    }
    strapi.log.info(`[brain-youtube] seeded ${seeds.length} channels`);
    return seeds.length;
  },

  /**
   * Sync every active channel. Returns per-channel results and the quota spent;
   * one channel failing never stops the others.
   */
  async sync({ uploadsLimit }: { uploadsLimit?: number } = {}) {
    if (!this.enabled()) {
      strapi.log.info('[brain-youtube] skipped — no YOUTUBE_API_KEY configured');
      return { ran: false, reason: 'no YOUTUBE_API_KEY', channels: [] as ChannelResult[], quota: 0 };
    }
    if (syncRunning) {
      strapi.log.info('[brain-youtube] skipped — another sync is already running');
      return { ran: false, reason: 'already running', channels: [] as ChannelResult[], quota: 0 };
    }
    syncRunning = true;
    const started = Date.now();
    try {
      const limit = Math.max(
        1,
        Math.min(
          Number(uploadsLimit ?? strapi.plugin('brain').config('youtubeUploadsLimit') ?? DEFAULT_UPLOADS_LIMIT) ||
            DEFAULT_UPLOADS_LIMIT,
          5000
        )
      );
      const today = utcDay();
      const channels = (await strapi.documents(UID.channel as any).findMany({
        filters: { active: true } as any,
        sort: 'handle:asc' as any,
        limit: 500,
      })) as any[];

      const quota = { used: 0 };
      const results: ChannelResult[] = [];
      for (const channel of channels) {
        try {
          results.push(await this.syncChannel(channel, { limit, today, quota }));
        } catch (err: any) {
          strapi.log.warn(`[brain-youtube] ${channel.handle} failed: ${err.message}`);
          results.push({ handle: channel.handle, ok: false, videos: 0, error: err.message });
        }
      }

      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok).map((r) => r.handle);
      const videos = ok.reduce((n, r) => n + r.videos, 0);
      strapi.log.info(
        `[brain-youtube] synced ${ok.length}/${results.length} channels, ${videos} videos, ` +
          `~${quota.used} quota units, ${((Date.now() - started) / 1000).toFixed(1)}s` +
          (failed.length ? ` — failed: ${failed.join(', ')}` : '')
      );
      return { ran: true, takenOn: today, uploadsLimit: limit, channels: results, videos, quota: quota.used };
    } finally {
      syncRunning = false;
    }
  },

  async syncChannel(channel: any, { limit, today, quota }: { limit: number; today: string; quota: { used: number } }) {
    // ---- channel: by id once known (stable), by handle the first time ----
    const found = await this.get('channels', {
      part: 'snippet,statistics,contentDetails',
      ...(channel.youtubeChannelId ? { id: channel.youtubeChannelId } : { forHandle: channel.handle }),
    });
    quota.used += 1;
    const item = found?.items?.[0];
    if (!item) throw new Error(`no channel found for ${channel.youtubeChannelId ?? channel.handle}`);

    const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads ?? null;
    await strapi.documents(UID.channel as any).update({
      documentId: channel.documentId,
      data: { youtubeChannelId: item.id, title: item.snippet?.title ?? null, uploadsPlaylistId, lastSyncedOn: today } as any,
    });

    const stats = item.statistics ?? {};
    await this.upsertSnapshot(UID.channelSnapshot, `${item.id}:${today}`, {
      channel: channel.documentId,
      takenOn: today,
      subscribers: stats.hiddenSubscriberCount ? null : toCount(stats.subscriberCount),
      totalViews: toCount(stats.viewCount),
      videoCount: toCount(stats.videoCount),
    });

    // ---- uploads: newest first, up to the limit ----
    if (!uploadsPlaylistId) return { handle: channel.handle, ok: true, videos: 0, uploadsUnavailable: true };
    const ids: string[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const page = await this.get('playlistItems', {
          part: 'contentDetails',
          playlistId: uploadsPlaylistId,
          maxResults: Math.min(PAGE_SIZE, limit - ids.length),
          pageToken,
        });
        quota.used += 1;
        for (const it of page?.items ?? []) {
          const id = it?.contentDetails?.videoId;
          if (id && !ids.includes(id)) ids.push(id);
        }
        pageToken = page?.nextPageToken;
      } while (pageToken && ids.length < limit);
    } catch (err: any) {
      // A channel can hide its uploads; the channel numbers above still count.
      if (err instanceof YouTubeError && err.status === 404) {
        strapi.log.info(`[brain-youtube] ${channel.handle}: uploads playlist unavailable (${err.reason}) — channel snapshot kept`);
        return { handle: channel.handle, ok: true, videos: 0, uploadsUnavailable: true };
      }
      throw err;
    }

    // ---- videos: metadata + today's numbers, 50 per call ----
    let videos = 0;
    for (let i = 0; i < ids.length; i += PAGE_SIZE) {
      const batch = ids.slice(i, i + PAGE_SIZE);
      const res = await this.get('videos', { part: 'snippet,statistics,contentDetails', id: batch.join(','), maxResults: PAGE_SIZE });
      quota.used += 1;
      videos += await this.upsertVideos(channel.documentId, res?.items ?? [], today);
    }
    return { handle: channel.handle, ok: true, videos };
  },

  /** Upsert one batch of videos.list items and their snapshot for today. */
  async upsertVideos(channelDocumentId: string, items: any[], today: string) {
    if (!items.length) return 0;
    const existing = (await strapi.documents(UID.video as any).findMany({
      filters: { youtubeVideoId: { $in: items.map((v) => v.id) } } as any,
      fields: ['youtubeVideoId'] as any,
      limit: items.length,
    })) as any[];
    const byYoutubeId = new Map(existing.map((v) => [v.youtubeVideoId, v.documentId]));

    let n = 0;
    for (const v of items) {
      const durationSeconds = parseIsoDuration(v.contentDetails?.duration);
      const data = {
        channel: channelDocumentId,
        title: v.snippet?.title ?? null,
        postedAt: v.snippet?.publishedAt ?? null,
        durationSeconds,
        isShort: isShortVideo(durationSeconds),
        // topic is a person's call — never written here
      };
      let documentId = byYoutubeId.get(v.id);
      if (documentId) {
        await strapi.documents(UID.video as any).update({ documentId, data: data as any });
      } else {
        const created: any = await strapi.documents(UID.video as any).create({ data: { youtubeVideoId: v.id, ...data } as any });
        documentId = created.documentId;
      }
      const s = v.statistics ?? {};
      await this.upsertSnapshot(UID.videoSnapshot, `${v.id}:${today}`, {
        video: documentId,
        takenOn: today,
        views: toCount(s.viewCount),
        likes: toCount(s.likeCount),
        comments: toCount(s.commentCount),
      });
      n += 1;
    }
    return n;
  },

  /** One row per thing per day: update today's if it exists, else create it. */
  async upsertSnapshot(uid: string, dayKey: string, data: Record<string, unknown>) {
    const existing: any = await strapi.documents(uid as any).findFirst({ filters: { dayKey } as any, fields: ['dayKey'] as any });
    if (existing) {
      await strapi.documents(uid as any).update({ documentId: existing.documentId, data: data as any });
      return;
    }
    try {
      await strapi.documents(uid as any).create({ data: { dayKey, ...data } as any });
    } catch (err: any) {
      // lost a race with a concurrent run: the unique index refused the second
      // row, which is the point of it. Anything else is a real failure.
      if (!/unique|duplicate/i.test(String(err?.message))) throw err;
    }
  },
});

export default youtube;
