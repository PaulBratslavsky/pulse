# brain — the marketing brain's data hub (phase 1: YouTube)

The "marketing brain" is a separate repo of Claude skills that write Strapi's marketing reports.
This plugin is where those skills read their numbers from and write their reports back to, so a
report next month can compare against this month's and check what was decided.

Phase 1 is YouTube: our channel and our competitors', snapshotted daily from the YouTube Data API.
HubSpot and Launchpad trial data come in later phases, as more content types in this plugin.

## Data model

All tables are prefixed `brain_` (Pulse already has a `channels` table).

| Content type | Fields | Notes |
|---|---|---|
| `plugin::brain.channel` | `handle` (unique), `youtubeChannelId` (unique), `title`, `kind` (own / competitor / creator), `active`, `uploadsPlaylistId`, `lastSyncedOn` | Seeded on first boot when empty. Inactive channels keep their history but are not synced or reported. |
| `plugin::brain.video` | `youtubeVideoId` (unique), `channel`, `title`, `postedAt`, `durationSeconds`, `isShort`, `topic` | `postedAt` is YouTube's publish time (Strapi owns `publishedAt`). `isShort` = 1–180 s; a live stream or premiere with no duration yet is not a Short. `topic` is set by people in the Content Manager and never overwritten by the sync. |
| `plugin::brain.channel-snapshot` | `channel`, `takenOn` (date), `subscribers` (null when hidden), `totalViews`, `videoCount`, `dayKey` (unique) | One per channel per UTC day. |
| `plugin::brain.video-snapshot` | `video`, `takenOn`, `views`, `likes`, `comments`, `dayKey` (unique) | One per video per UTC day. Likes/comments null when hidden or off. |
| `plugin::brain.report` | `date`, `kind` (`youtube-monthly`), `summary` (Markdown), `data` (JSON), `decisions`, `via` | One per kind and date. |
| `plugin::brain.decision` | `report`, `text`, `owner`, `due`, `status` (open / done / dropped), `outcome`, `via` | |

`dayKey` is `<YouTube id>:<YYYY-MM-DD>`. It is what makes a second run on the same day update that
day's row instead of adding one, and its unique index (declared on the schema, created by Strapi's
schema sync) is what stops a race between the cron and a manual run from inserting two.

## The sync

`strapi.plugin('brain').service('youtube').sync()` — for every active channel:

1. `channels.list` (snippet, statistics, contentDetails) by id, or by `forHandle` the first time — 1 unit
2. `playlistItems.list` over the uploads playlist, 50 a page, newest first, up to
   `youtubeUploadsLimit` (default 100) — 1 unit a page
3. `videos.list` (snippet, statistics, contentDetails) in batches of 50 — 1 unit a batch

That is ~3 units a channel plus 2 per extra 50 uploads (~35 a run for the seven seeded channels, of a
10,000-unit daily quota). A channel whose uploads playlist is hidden (404) keeps its channel snapshot.
One failing channel never stops the rest. Each run logs one line:

```
[brain-youtube] synced 7/7 channels, 640 videos, ~35 quota units, 4.2s
```

The key goes in the `x-goog-api-key` header, never the URL, so it cannot reach a log line or an error
message; no route or tool returns it.

**When it runs**

- Daily at 05:00 UTC (`brainYoutubeSync`, scheduled by the plugin's `bootstrap()`), **only** when
  `BRAIN_YOUTUBE_SYNC=true`. Override the time with `BRAIN_YOUTUBE_SYNC_CRON`. A crash is logged, and
  posted to the host app's ops channel if it has one (Pulse's `api::notify.slack`).
- On demand: `POST /brain/youtube/sync` (admin API, body `{ "uploadsLimit": 200 }` optional), gated by
  the plugin action `plugin::brain.youtube.sync` (Roles / Admin Token → Plugins tab → brain).

Snapshots only start when the sync first sees a video, so videos older than the brain have no ~7 or
~30 day numbers. That is reported as missing, never as zero.

## Tools

Defined in `server/src/mcp/tools.ts` and registered on Strapi's built-in MCP server by the plugin's own
`register()` (`server/src/mcp/index.ts`). Each is gated by its own plugin permission action,
`plugin::brain.tools.<name>` (Admin Token / Role screens → Plugins tab → brain → "MCP tools"). Pulse's
tool registry and in-app assistant don't include them.

| Tool | Access | What it returns |
|---|---|---|
| `brain-guide` | read | How to use the brain and read its numbers (`server/src/mcp/guide.ts`), plus the running build: version, commit, build time, boot time. Agents call it once a session |
| `brain-health` | read | Data freshness: status (`ok` / `attention` / `off`), the sync switch and its last run (kept in the plugin store), each channel's newest snapshot, the day expected and the days missing in the window, overdue decisions, the latest report, and plain-language findings. Agents call it before writing a report |
| `brain-youtube-channels` | read | Each active channel's latest snapshot, its baseline N days ago (default 30), deltas in subscribers and total views, long videos and Shorts published in the window, median views of its last 10 long videos |
| `brain-youtube-videos` | read | A channel's videos (filters: `since`, `shorts`, `topic`), each with latest views and views per day since publish |
| `brain-video-results` | read | One video's views at ~7, ~30 and ~90 days (nearest snapshot within ±2 / ±4 / ±11 days; null with a reason otherwise), plus the median of the same milestones across its channel's videos with the same topic and format |
| `brain-save-report` | write | Saves a report and its proposed decisions (open). Refuses a second report for the same kind and date unless `overwrite: true`, which replaces summary and data but never removes decisions |
| `brain-decisions` | read | Decisions, open by default, soonest due first, with their report |
| `brain-update-decision` | write | Partial: status and/or outcome |

Write tools are conditional, partial, stamped with `via`, and internal — nothing is posted anywhere.

## Checking a deploy

Call `brain-guide` through the production connector after a deploy: its `build` says which code is
running (`version` from this package.json, `commit`, `builtAt`, and `bootedAt`, which changes on every
restart). Bump the version in `package.json` with each change worth telling apart. CI checks the tools
end to end with a brain-only token (`apps/web/e2e/brain-mcp.spec.ts`).

Never rename a tool or its permission action (`plugin::brain.tools.<name>`): admin deletes grants for
actions that no longer exist, so every token silently loses that tool. (They were renamed once, in the
move into the plugin.) Display names and the sub-category are safe to change.

## Boundary

The plugin owns all of its pieces: content types, services, routes, cron, MCP tools and permissions.
Pulse refers to it only in `config/plugins.ts`, and the plugin imports nothing from Pulse. CI enforces
both with `apps/cms/scripts/check-brain-boundary.mjs`. New phases (HubSpot, Launchpad) follow the same
rule: add them here, never to Pulse's registry or `config/cron-tasks.ts`.

## Configuration

| Env | Default | |
|---|---|---|
| `YOUTUBE_API_KEY` | empty | YouTube Data API v3 key. Empty = the sync is a logged no-op |
| `BRAIN_YOUTUBE_SYNC` | `false` | `true` turns the daily cron on |
| `BRAIN_YOUTUBE_SYNC_CRON` | `0 5 * * *` | When the cron runs (UTC) |
| `BRAIN_YOUTUBE_UPLOADS_LIMIT` | `100` | Newest uploads read per channel per run (plugin config `youtubeUploadsLimit`) |

## Code

| Path | |
|---|---|
| `server/src/register.ts` | Permission actions (sync + one per tool) and the MCP tools |
| `server/src/bootstrap.ts` | Channel seed and the daily cron |
| `server/src/mcp/tools.ts`, `server/src/mcp/index.ts` | The eight tools, and their registration on the MCP server |
| `server/src/mcp/guide.ts` | The text `brain-guide` returns, and the build-stamp reader |
| `server/src/services/health.ts` | What `brain-health` checks |
| `scripts/build-info.mjs` | Writes `dist/server/build-info.json` (version, commit, build time) after every build |
| `server/src/content-types/index.ts` | The six schemas and their indexes |
| `server/src/services/youtube.ts` | API client, sync, upserts, channel seed |
| `server/src/services/stats.ts` | The read side of the YouTube tools |
| `server/src/services/reports.ts` | Reports and decisions |
| `server/src/utils/youtube-math.ts` | Pure arithmetic: durations, Shorts, median, views per day, 7/30/90-day lookup — unit-tested in `apps/web/e2e/brain-youtube.spec.ts` |

Build: `npm run build` here (the CMS runs it for every local plugin before `develop` and `build`).
