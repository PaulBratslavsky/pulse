/**
 * Filters for "Find on the blog", kept in the URL so a filtered search can be
 * shared or reloaded.
 *
 * The defaults lean on purpose: much of the marketing blog is SEO material or
 * written for Strapi v3/v4, and the point of the tab is posts worth sending
 * someone today. Each default is one click to undo.
 *
 *   age     1y | 2y (default) | all   — first published within
 *   old     "show" keeps posts marked v3/v4 (hidden by default)
 *   exclude comma list of categories to leave out; absent = the defaults,
 *           "none" = leave nothing out
 */
export const DEFAULT_EXCLUDED_CATEGORIES = ['Company', 'Ecosystem']

export type TBlogFilters = { age: '1y' | '2y' | 'all'; showOld: boolean; exclude: string[] }

export function parseBlogFilters(params: { age?: string; old?: string; exclude?: string }): TBlogFilters {
  const age = params.age === '1y' || params.age === 'all' ? params.age : '2y'
  const exclude =
    params.exclude === undefined
      ? DEFAULT_EXCLUDED_CATEGORIES
      : params.exclude === 'none'
        ? []
        : params.exclude.split(',').filter(Boolean)
  return { age, showOld: params.old === 'show', exclude }
}

/** The earliest first-published date the age filter allows, or null for all time. */
export function sinceFor(age: TBlogFilters['age']): string | null {
  if (age === 'all') return null
  const d = new Date()
  d.setFullYear(d.getFullYear() - (age === '1y' ? 1 : 2))
  return d.toISOString().slice(0, 10)
}

/** The URL params for these filters, writing only what differs from the defaults. */
export function blogFilterParams(f: TBlogFilters): Record<string, string> {
  const out: Record<string, string> = {}
  if (f.age !== '2y') out.age = f.age
  if (f.showOld) out.old = 'show'
  const same =
    f.exclude.length === DEFAULT_EXCLUDED_CATEGORIES.length &&
    DEFAULT_EXCLUDED_CATEGORIES.every((c) => f.exclude.includes(c))
  if (!same) out.exclude = f.exclude.length ? f.exclude.join(',') : 'none'
  return out
}
