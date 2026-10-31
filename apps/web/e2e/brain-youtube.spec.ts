import { test, expect } from '@playwright/test'

import {
  addDays,
  daysBetween,
  delta,
  isShortVideo,
  median,
  milestoneTolerance,
  parseIsoDuration,
  toCount,
  viewsAtMilestones,
  viewsPerDay,
} from '../../cms/src/plugins/brain/server/src/utils/youtube-math'

/**
 * The brain plugin's YouTube arithmetic. No browser and no stack: these are
 * the pure functions every brain-youtube-* number goes through, so a table of
 * cases says more than a sync against the live API would.
 */

test.describe('ISO 8601 durations from videos.list', () => {
  const CASES: Array<[string, number | null]> = [
    ['PT59S', 59],
    ['PT3M', 180],
    ['PT3M1S', 181],
    ['PT1H2M3S', 3723],
    ['PT10M', 600],
    ['P1DT2H', 93_600],
    ['P1W', 604_800],
    ['P0D', 0], // upcoming live or premiere
    ['PT1.5S', 2],
    ['', null],
    ['P', null],
    ['PT', null],
    ['3:21', null],
  ]
  for (const [input, want] of CASES) test(`${input || '(empty)'} → ${want}`, () => expect(parseIsoDuration(input)).toBe(want))

  test('non-strings are null, never 0', () => {
    expect(parseIsoDuration(undefined)).toBeNull()
    expect(parseIsoDuration(42)).toBeNull()
  })
})

test.describe('what counts as a Short', () => {
  test('1..180 s is a Short', () => {
    expect(isShortVideo(1)).toBe(true)
    expect(isShortVideo(59)).toBe(true)
    expect(isShortVideo(180)).toBe(true)
  })
  test('over 180 s is not', () => expect(isShortVideo(181)).toBe(false))
  test('a zero or unknown duration (live, premiere) is not a Short', () => {
    expect(isShortVideo(0)).toBe(false)
    expect(isShortVideo(null)).toBe(false)
    expect(isShortVideo(undefined)).toBe(false)
  })
})

test.describe('median', () => {
  test('odd and even counts', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
  test('ignores nulls; none at all is null', () => {
    expect(median([null, 10, undefined, 20])).toBe(15)
    expect(median([])).toBeNull()
    expect(median([null])).toBeNull()
  })
})

test.describe('days and views per day', () => {
  test('UTC calendar days, whatever the time of day', () => {
    expect(daysBetween('2026-10-01T23:59:00Z', '2026-10-02T00:01:00Z')).toBe(1)
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30)
    expect(addDays('2026-10-30', -30)).toBe('2026-09-30')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
  test('views per day since publish', () => {
    expect(viewsPerDay(3000, '2026-10-01T15:00:00Z', '2026-10-31')).toBe(100)
    expect(viewsPerDay(1000, '2026-10-01T00:00:00Z', '2026-10-04')).toBe(333.3)
  })
  test('published today divides by one, not zero', () => {
    expect(viewsPerDay(50, '2026-10-30T08:00:00Z', '2026-10-30')).toBe(50)
  })
  test('unknown views stay unknown', () => expect(viewsPerDay(null, '2026-10-01', '2026-10-30')).toBeNull())
})

test.describe('views at ~7, ~30 and ~90 days', () => {
  const published = '2026-06-01T16:00:00Z'
  const snaps = [
    { takenOn: '2026-06-07', views: 600 }, // day 6
    { takenOn: '2026-06-09', views: 800 }, // day 8 — ties day 6 on distance; the earlier wins
    { takenOn: '2026-07-02', views: 2000 }, // day 31
    { takenOn: '2026-07-05', views: 2100 },
  ]

  test('nearest snapshot within the tolerance, earlier on a tie', () => {
    const [d7, d30, d90] = viewsAtMilestones(published, snaps, '2026-10-30')
    expect(d7).toMatchObject({ day: 7, views: 600, takenOn: '2026-06-07', daysAfterPublish: 6, missing: null })
    expect(d30).toMatchObject({ day: 30, views: 2000, daysAfterPublish: 31, missing: null })
    // reached, but no snapshot within ±11 days of day 90
    expect(d90).toMatchObject({ day: 90, views: null, missing: 'no-snapshot' })
  })

  test('a day still in the future is not-reached, not zero', () => {
    const [d7, d30, d90] = viewsAtMilestones(published, snaps, '2026-06-20')
    expect(d7.missing).toBeNull()
    expect(d30).toMatchObject({ views: null, missing: 'not-reached' })
    expect(d90).toMatchObject({ views: null, missing: 'not-reached' })
  })

  test('a snapshot outside the tolerance does not count', () => {
    expect(milestoneTolerance(7)).toBe(2)
    expect(milestoneTolerance(30)).toBe(4)
    expect(milestoneTolerance(90)).toBe(11)
    const [d7] = viewsAtMilestones(published, [{ takenOn: '2026-06-11', views: 900 }], '2026-10-30') // day 10
    expect(d7).toMatchObject({ views: null, missing: 'no-snapshot' })
  })

  test('snapshots with unknown views are skipped', () => {
    const [d7] = viewsAtMilestones(published, [{ takenOn: '2026-06-08', views: null }], '2026-10-30')
    expect(d7.missing).toBe('no-snapshot')
  })
})

test.describe('counts from the API and deltas', () => {
  test('string counts become numbers; missing stays null', () => {
    expect(toCount('12345')).toBe(12345)
    expect(toCount(undefined)).toBeNull()
    expect(toCount('')).toBeNull()
    expect(toCount('n/a')).toBeNull()
  })
  test('a delta needs both sides', () => {
    expect(delta(120, 100)).toBe(20)
    expect(delta(null, 100)).toBeNull() // hidden subscriber count
    expect(delta(120, undefined)).toBeNull()
  })
})
