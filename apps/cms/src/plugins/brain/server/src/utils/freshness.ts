import { addDays, utcDay } from './youtube-math';

/**
 * When a daily snapshot counts as late, for brain-health. Pure and free of
 * Strapi imports, so the unit tests (and the web app's type check, which
 * includes them) can load it directly.
 */

/** The UTC hour a daily rule like "0 5 * * *" runs at, or null for anything else. */
export const ruleHour = (rule: string): number | null => {
  const [minute, hour, dom, month, dow] = rule.trim().split(/\s+/);
  if ([dom, month, dow].some((f) => f !== '*') || !/^\d+$/.test(minute ?? '') || !/^\d+$/.test(hour ?? '')) return null;
  const h = Number(hour);
  return h >= 0 && h <= 23 ? h : null;
};

/**
 * The newest snapshot day a healthy daily sync has written by `now`: today once
 * the run's hour has passed (one hour of grace), yesterday before that. For a
 * schedule that isn't a plain daily rule, yesterday.
 */
export const expectedLatestDay = (now: Date, rule: string): string => {
  const hour = ruleHour(rule);
  const today = utcDay(now);
  return hour !== null && now.getUTCHours() >= hour + 1 ? today : addDays(today, -1);
};

/** Days in [from, to] (both YYYY-MM-DD) that are not in `have`. */
export const missingDays = (from: string, to: string, have: Set<string>): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!have.has(d)) out.push(d);
  return out;
};
