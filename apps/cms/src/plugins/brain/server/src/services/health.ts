import type { Core } from '@strapi/strapi';

import { UID } from '../content-types';
import { expectedLatestDay, missingDays } from '../utils/freshness';
import { addDays, utcDay } from '../utils/youtube-math';

/**
 * Is the brain's data fresh and complete? What brain-health returns: the sync
 * switch and its last run, each tracked channel's newest snapshot and the days
 * it is missing, overdue decisions, and the latest report. With a daily sync a
 * silent gap is the likeliest failure, and a report written over one would
 * compare the wrong days.
 *
 * Read-only and computed from stored data; the YouTube API key is reported as
 * configured or not, never its value.
 */

const docs = (strapi: Core.Strapi, uid: string) => strapi.documents(uid as any) as any;

const DEFAULT_RULE = '0 5 * * *';

export const health = ({ strapi }: { strapi: Core.Strapi }) => ({
  async check({ days = 14 }: { days?: number } = {}) {
    const window = Math.max(1, Math.min(Number(days) || 14, 90));
    const now = new Date();
    const today = utcDay(now);
    const from = addDays(today, -(window - 1));
    const rule = process.env.BRAIN_YOUTUBE_SYNC_CRON || DEFAULT_RULE;
    const expected = expectedLatestDay(now, rule);

    const sync = {
      enabled: process.env.BRAIN_YOUTUBE_SYNC === 'true',
      apiKeyConfigured: Boolean(process.env.YOUTUBE_API_KEY),
      schedule: `${rule} (UTC)`,
      lastRun: await (strapi.plugin('brain').service('youtube') as any).lastRun(),
    };

    const channels = (await docs(strapi, UID.channel).findMany({
      filters: { active: true },
      fields: ['handle', 'kind', 'lastSyncedOn'],
      sort: 'handle:asc',
      limit: 500,
    })) as any[];

    const snapshots = (await docs(strapi, UID.channelSnapshot).findMany({
      filters: { takenOn: { $gte: from } },
      fields: ['takenOn'],
      populate: { channel: { fields: ['documentId'] } },
      limit: Math.max(100, channels.length * window),
    })) as any[];
    const daysByChannel = new Map<string, Set<string>>();
    for (const s of snapshots) {
      const id = s.channel?.documentId;
      if (!id) continue;
      if (!daysByChannel.has(id)) daysByChannel.set(id, new Set());
      daysByChannel.get(id)!.add(String(s.takenOn).slice(0, 10));
    }

    const channelHealth = await Promise.all(
      channels.map(async (c) => {
        const newest: any = await docs(strapi, UID.channelSnapshot).findFirst({
          filters: { channel: { documentId: c.documentId } },
          fields: ['takenOn'],
          sort: 'takenOn:desc',
        });
        const first: any = await docs(strapi, UID.channelSnapshot).findFirst({
          filters: { channel: { documentId: c.documentId } },
          fields: ['takenOn'],
          sort: 'takenOn:asc',
        });
        const latest = newest ? String(newest.takenOn).slice(0, 10) : null;
        const historyStartsOn = first ? String(first.takenOn).slice(0, 10) : null;
        // only days the brain was already tracking this channel count as missing
        const gapFrom = historyStartsOn && historyStartsOn > from ? historyStartsOn : from;
        const missing = historyStartsOn ? missingDays(gapFrom, expected, daysByChannel.get(c.documentId) ?? new Set()) : [];
        return {
          handle: c.handle,
          kind: c.kind,
          status: !latest ? 'never-synced' : latest < expected ? 'stale' : 'ok',
          latestSnapshot: latest,
          historyStartsOn,
          missingDays: missing,
        };
      })
    );

    const open = (await docs(strapi, UID.decision).findMany({
      filters: { status: 'open' },
      fields: ['text', 'owner', 'due'],
      limit: 500,
    })) as any[];
    const overdue = open
      .filter((d) => d.due && String(d.due).slice(0, 10) < today)
      .sort((a, b) => String(a.due).localeCompare(String(b.due)))
      .map((d) => ({ documentId: d.documentId, text: d.text, owner: d.owner ?? null, due: String(d.due).slice(0, 10) }));

    const lastReport: any = await docs(strapi, UID.report).findFirst({ fields: ['kind', 'date'], sort: 'date:desc' });

    const findings: { severity: 'warn' | 'info'; message: string }[] = [];
    if (!sync.enabled) findings.push({ severity: 'warn', message: 'The daily sync is off (BRAIN_YOUTUBE_SYNC is not "true"): no new snapshots will arrive.' });
    if (!sync.apiKeyConfigured) findings.push({ severity: 'warn', message: 'YOUTUBE_API_KEY is not set, so every sync is a no-op.' });
    if (sync.lastRun?.crashed) findings.push({ severity: 'warn', message: `The last sync crashed at ${sync.lastRun.at}: ${sync.lastRun.crashed}` });
    for (const f of sync.lastRun?.failed ?? []) findings.push({ severity: 'warn', message: `${f.handle} failed in the last sync: ${f.error ?? 'unknown error'}` });
    for (const c of channelHealth) {
      if (c.status === 'never-synced') findings.push({ severity: 'warn', message: `${c.handle} has never been synced.` });
      else if (c.status === 'stale') findings.push({ severity: 'warn', message: `${c.handle}'s newest snapshot is ${c.latestSnapshot}; expected ${expected}.` });
      if (c.missingDays.length) findings.push({ severity: 'info', message: `${c.handle} has no snapshot for ${c.missingDays.length} day(s) since ${c.missingDays[0]}; a report comparing across those days should say the data is missing.` });
    }
    if (overdue.length) findings.push({ severity: 'info', message: `${overdue.length} open decision(s) are past due.` });

    const status = !sync.enabled || !sync.apiKeyConfigured ? 'off' : findings.some((f) => f.severity === 'warn') ? 'attention' : 'ok';

    return {
      status,
      today,
      expectedLatestSnapshot: expected,
      windowDays: window,
      sync,
      channels: channelHealth,
      decisions: { open: open.length, overdue },
      lastReport: lastReport ? { documentId: lastReport.documentId, kind: lastReport.kind, date: lastReport.date } : null,
      findings,
    };
  },
});

export default health;
