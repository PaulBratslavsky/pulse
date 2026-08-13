import type { TQueueSearchParams } from '@/types'

/**
 * The old lib/strapi `qs` helper, kept here as its last remaining caller.
 *
 * Deliberately NOT the npm `qs` package: this string is browser-facing and must
 * not change shape — it is stored and replayed to restore a view. The package
 * builds the outbound Strapi request, where nested filters pay for themselves.
 */
function searchString(params: Record<string, string | undefined>): string {
  return (
    '?' +
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
  )
}

/**
 * In the order the original built them, so the stored string is byte-identical.
 * `awaiting` IS carried here — unlike in filter-url.ts, which never wrote it.
 */
const CARRIED = [
  'status',
  'sentiment',
  'topic',
  'topics',
  'draft',
  'awaiting',
  'quality',
  'lane',
  'sort',
  'q',
  'every',
] as const

/**
 * The query as the browser has it, so returning here restores this exact view.
 * Page 1 is left out — it is the default, and a URL that says so is noise.
 */
export function buildCurrentSearch(params: TQueueSearchParams, page: number): string {
  const carried: Record<string, string | undefined> = {}
  for (const key of CARRIED) if (params[key]) carried[key] = params[key]
  if (page > 1) carried.page = String(page)
  return searchString(carried)
}
