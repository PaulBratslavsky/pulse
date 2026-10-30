/**
 * The pure arithmetic behind the brain's YouTube tools — no Strapi, no fetch,
 * no imports, so the unit suite (apps/web/e2e/brain-youtube.spec.ts) can run it
 * without a stack. Everything that turns raw API values or snapshot rows into a
 * number an agent reads lives here.
 */

/** A video this long or shorter counts as a Short (YouTube allows up to 3 min). */
export const SHORT_MAX_SECONDS = 180;

const DAY_MS = 86_400_000;

/**
 * ISO 8601 duration (what videos.list contentDetails.duration returns) to
 * seconds. YouTube writes PT#H#M#S, P#DT#H#M#S for long streams, and P0D for an
 * upcoming live or premiere. Anything unparseable is null, never 0: a guessed
 * 0 would read as a Short.
 */
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value.trim());
  if (!m || value.trim() === 'P' || value.trim().endsWith('T')) return null;
  const [, w, d, h, min, s] = m;
  return Math.round(
    Number(w ?? 0) * 7 * 86_400 + Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(min ?? 0) * 60 + Number(s ?? 0)
  );
}

/**
 * Short = 1..180 s. A zero or unknown duration is a live stream or premiere that
 * has not happened yet, not a Short.
 */
export function isShortVideo(durationSeconds: number | null | undefined): boolean {
  return typeof durationSeconds === 'number' && durationSeconds > 0 && durationSeconds <= SHORT_MAX_SECONDS;
}

/** Median of the finite numbers given; null for none. Even counts average the middle two. */
export function median(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** YYYY-MM-DD in UTC — the one calendar the snapshots use. */
export function utcDay(date: Date | string | number = new Date()): string {
  return new Date(date).toISOString().slice(0, 10);
}

/** `day` moved by n whole days (n may be negative), as YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  return utcDay(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + n * DAY_MS);
}

/** Whole UTC calendar days from a to b (b later = positive). */
export function daysBetween(a: Date | string, b: Date | string): number {
  const start = Date.parse(`${utcDay(a)}T00:00:00Z`);
  const end = Date.parse(`${utcDay(b)}T00:00:00Z`);
  return Math.round((end - start) / DAY_MS);
}

/**
 * Average views per day since publish, as of the snapshot day. The first day
 * counts as one, so a video published this morning is not divided by zero.
 */
export function viewsPerDay(views: number | null | undefined, publishedAt: Date | string, asOf: Date | string): number | null {
  if (typeof views !== 'number' || !Number.isFinite(views)) return null;
  const days = Math.max(1, daysBetween(publishedAt, asOf));
  return Math.round((views / days) * 10) / 10;
}

export type ViewSnapshot = { takenOn: string; views: number | null };

export type Milestone = {
  day: number;
  /** views on the snapshot closest to publish + day, null when there is none */
  views: number | null;
  /** the snapshot actually used, and how many days after publish it was taken */
  takenOn: string | null;
  daysAfterPublish: number | null;
  /** why views is null: the day is still in the future, or no snapshot is close enough */
  missing: 'not-reached' | 'no-snapshot' | null;
};

export const MILESTONE_DAYS = [7, 30, 90] as const;

/** How far either side of the target day a snapshot may be and still count as "~N days". */
export const milestoneTolerance = (day: number) => Math.max(2, Math.round(day * 0.12));

/**
 * Views at ~7, ~30 and ~90 days after publish, from the daily snapshots. The
 * snapshot nearest the target day wins (the earlier one on a tie), within
 * milestoneTolerance. Snapshots only start when the sync first sees a video, so
 * an old video has no ~7 day value: that is 'no-snapshot', not zero.
 */
export function viewsAtMilestones(
  publishedAt: Date | string,
  snapshots: ViewSnapshot[],
  today: Date | string = new Date(),
  days: readonly number[] = MILESTONE_DAYS
): Milestone[] {
  const age = daysBetween(publishedAt, today);
  return days.map((day) => {
    if (age < day) return { day, views: null, takenOn: null, daysAfterPublish: null, missing: 'not-reached' };
    let best: { snap: ViewSnapshot; after: number; off: number } | null = null;
    for (const snap of snapshots) {
      if (typeof snap.views !== 'number') continue;
      const after = daysBetween(publishedAt, snap.takenOn);
      const off = Math.abs(after - day);
      if (off > milestoneTolerance(day)) continue;
      if (!best || off < best.off || (off === best.off && after < best.after)) best = { snap, after, off };
    }
    return best
      ? { day, views: best.snap.views, takenOn: best.snap.takenOn, daysAfterPublish: best.after, missing: null }
      : { day, views: null, takenOn: null, daysAfterPublish: null, missing: 'no-snapshot' };
  });
}

/** b - a, or null when either side is unknown (a hidden subscriber count, say). */
export function delta(current: number | null | undefined, baseline: number | null | undefined): number | null {
  return typeof current === 'number' && typeof baseline === 'number' ? current - baseline : null;
}

/** API statistics arrive as strings; a missing one stays null rather than 0. */
export function toCount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
