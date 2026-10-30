/**
 * The brain's data model (phase 1: YouTube). Tables are prefixed `brain_` so
 * they can never collide with Pulse's own (Pulse already has a `channels` table
 * for social platforms).
 *
 * Indexes are declared on the schema, so Strapi's schema sync creates them on
 * SQLite and Postgres alike. They matter here because Strapi 5's `unique: true`
 * is checked by the content API only: Document Service writes, which is all the
 * sync does, would otherwise insert duplicates on a race (see
 * src/utils/dedupe-mentions.ts for the time that happened to mentions).
 *
 * `publishedAt` is Strapi's own column on every v5 content type, so a video's
 * YouTube publish time is stored as `postedAt` (the same name mention uses).
 */

const PLUGIN = 'plugin::brain';

const channel = {
  schema: {
    kind: 'collectionType',
    collectionName: 'brain_channels',
    info: {
      singularName: 'channel',
      pluralName: 'channels',
      displayName: 'YouTube channel',
      description: 'A YouTube channel the brain tracks: ours, a competitor, or a creator.',
    },
    options: { draftAndPublish: false },
    pluginOptions: { 'content-manager': { visible: true }, 'content-type-builder': { visible: false } },
    attributes: {
      /** "@Strapi" — what a person types; resolved to youtubeChannelId on first sync */
      handle: { type: 'string', required: true, unique: true },
      /** "UC…", filled in by the sync; once set, the sync looks the channel up by id */
      youtubeChannelId: { type: 'string', unique: true },
      title: { type: 'string' },
      kind: { type: 'enumeration', enum: ['own', 'competitor', 'creator'], required: true, default: 'competitor' },
      /** inactive channels keep their history but are no longer synced or reported */
      active: { type: 'boolean', default: true, required: true },
      /** uploads playlist id, cached so a run does not need to re-derive it */
      uploadsPlaylistId: { type: 'string' },
      lastSyncedOn: { type: 'date' },
    },
    indexes: [
      { name: 'brain_channels_handle_uq', columns: ['handle'], type: 'unique' },
      { name: 'brain_channels_youtube_channel_id_uq', columns: ['youtube_channel_id'], type: 'unique' },
    ],
  },
};

const video = {
  schema: {
    kind: 'collectionType',
    collectionName: 'brain_videos',
    info: {
      singularName: 'video',
      pluralName: 'videos',
      displayName: 'YouTube video',
      description: 'One upload on a tracked channel. Metadata only; numbers live on video-snapshot.',
    },
    options: { draftAndPublish: false },
    pluginOptions: { 'content-manager': { visible: true }, 'content-type-builder': { visible: false } },
    attributes: {
      youtubeVideoId: { type: 'string', required: true, unique: true },
      channel: { type: 'relation', relation: 'manyToOne', target: `${PLUGIN}.channel` },
      title: { type: 'string' },
      /** when YouTube published it (not Strapi's publishedAt) */
      postedAt: { type: 'datetime' },
      durationSeconds: { type: 'integer' },
      /** 1..180 s; a live stream or premiere with no duration yet is not a Short */
      isShort: { type: 'boolean', default: false },
      /** set by a person (or a later tool); the sync never overwrites it */
      topic: { type: 'string' },
    },
    indexes: [
      { name: 'brain_videos_youtube_video_id_uq', columns: ['youtube_video_id'], type: 'unique' },
      { name: 'brain_videos_posted_at_idx', columns: ['posted_at'] },
    ],
  },
};

const channelSnapshot = {
  schema: {
    kind: 'collectionType',
    collectionName: 'brain_channel_snapshots',
    info: {
      singularName: 'channel-snapshot',
      pluralName: 'channel-snapshots',
      displayName: 'YouTube channel snapshot',
      description: "A channel's public counters on one UTC day. One per channel per day.",
    },
    options: { draftAndPublish: false },
    pluginOptions: { 'content-manager': { visible: true }, 'content-type-builder': { visible: false } },
    attributes: {
      channel: { type: 'relation', relation: 'manyToOne', target: `${PLUGIN}.channel` },
      takenOn: { type: 'date', required: true },
      /** null when the channel hides its subscriber count */
      subscribers: { type: 'biginteger' },
      totalViews: { type: 'biginteger' },
      videoCount: { type: 'integer' },
      /** `<youtubeChannelId>:<takenOn>` — the one-per-day key the upsert and unique index use */
      dayKey: { type: 'string', required: true, unique: true },
    },
    indexes: [
      { name: 'brain_channel_snapshots_day_key_uq', columns: ['day_key'], type: 'unique' },
      { name: 'brain_channel_snapshots_taken_on_idx', columns: ['taken_on'] },
    ],
  },
};

const videoSnapshot = {
  schema: {
    kind: 'collectionType',
    collectionName: 'brain_video_snapshots',
    info: {
      singularName: 'video-snapshot',
      pluralName: 'video-snapshots',
      displayName: 'YouTube video snapshot',
      description: "A video's public counters on one UTC day. One per video per day.",
    },
    options: { draftAndPublish: false },
    pluginOptions: { 'content-manager': { visible: true }, 'content-type-builder': { visible: false } },
    attributes: {
      video: { type: 'relation', relation: 'manyToOne', target: `${PLUGIN}.video` },
      takenOn: { type: 'date', required: true },
      views: { type: 'biginteger' },
      /** null when the owner hides likes or turns comments off */
      likes: { type: 'biginteger' },
      comments: { type: 'biginteger' },
      /** `<youtubeVideoId>:<takenOn>` */
      dayKey: { type: 'string', required: true, unique: true },
    },
    indexes: [
      { name: 'brain_video_snapshots_day_key_uq', columns: ['day_key'], type: 'unique' },
      { name: 'brain_video_snapshots_taken_on_idx', columns: ['taken_on'] },
    ],
  },
};

const report = {
  schema: {
    kind: 'collectionType',
    collectionName: 'brain_reports',
    info: {
      singularName: 'report',
      pluralName: 'reports',
      displayName: 'Brain report',
      description: 'A report a marketing-brain skill wrote (e.g. the monthly YouTube review), with its numbers.',
    },
    options: { draftAndPublish: false },
    pluginOptions: { 'content-manager': { visible: true }, 'content-type-builder': { visible: false } },
    attributes: {
      date: { type: 'date', required: true },
      kind: { type: 'enumeration', enum: ['youtube-monthly'], required: true, default: 'youtube-monthly' },
      /** Markdown, written for people */
      summary: { type: 'richtext' },
      /** the numbers the summary was written from, for the next report to compare against */
      data: { type: 'json' },
      decisions: { type: 'relation', relation: 'oneToMany', target: `${PLUGIN}.decision`, mappedBy: 'report' },
      /** who wrote it: 'mcp', 'chat' or 'admin' */
      via: { type: 'string' },
    },
    indexes: [{ name: 'brain_reports_kind_date_idx', columns: ['kind', 'date'] }],
  },
};

const decision = {
  schema: {
    kind: 'collectionType',
    collectionName: 'brain_decisions',
    info: {
      singularName: 'decision',
      pluralName: 'decisions',
      displayName: 'Brain decision',
      description: 'Something a report said we would do, who owns it, and how it turned out.',
    },
    options: { draftAndPublish: false },
    pluginOptions: { 'content-manager': { visible: true }, 'content-type-builder': { visible: false } },
    attributes: {
      report: { type: 'relation', relation: 'manyToOne', target: `${PLUGIN}.report`, inversedBy: 'decisions' },
      text: { type: 'text', required: true },
      owner: { type: 'string' },
      due: { type: 'date' },
      status: { type: 'enumeration', enum: ['open', 'done', 'dropped'], required: true, default: 'open' },
      outcome: { type: 'text' },
      /** who last wrote it: 'mcp', 'chat' or 'admin' */
      via: { type: 'string' },
    },
    indexes: [{ name: 'brain_decisions_status_idx', columns: ['status'] }],
  },
};

export const contentTypes = {
  channel,
  video,
  'channel-snapshot': channelSnapshot,
  'video-snapshot': videoSnapshot,
  report,
  decision,
};

export const UID = {
  channel: `${PLUGIN}.channel`,
  video: `${PLUGIN}.video`,
  channelSnapshot: `${PLUGIN}.channel-snapshot`,
  videoSnapshot: `${PLUGIN}.video-snapshot`,
  report: `${PLUGIN}.report`,
  decision: `${PLUGIN}.decision`,
} as const;
