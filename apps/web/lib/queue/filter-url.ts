import type { TQueueFilterOverrides, TQueueSearchParams } from '@/types'

/**
 * Every filter that survives a link, in the order the original set them.
 *
 * `awaiting` is last because it was missing entirely: the old filterUrl
 * declared it in the override type and then never read or wrote it, so the
 * "awaiting reply" pill linked to a URL without the param and could never go
 * active. The filter itself always worked — the page reads params.awaiting, and
 * currentSearch carried it — so only the one route in, the pill, was dead.
 * Appended rather than slotted in alphabetically so every other filter's URL is
 * unchanged.
 */
const FILTER_KEYS = [
  'status',
  'sentiment',
  'topic',
  'draft',
  'quality',
  'topics',
  'sort',
  'q',
  'lane',
  'every',
  'awaiting',
] as const

/**
 * Builds queue URLs relative to the filters currently in the address bar.
 *
 * `key in over` — NOT `over[key] !== undefined` — so passing an explicit
 * undefined actually CLEARS the filter. The "all" chip and the topic ✕ depend
 * on it: they pass `{ topic: undefined }` and mean it.
 */
export function makeFilterUrl(params: TQueueSearchParams) {
  return (over: TQueueFilterOverrides): string => {
    const q = new URLSearchParams()

    for (const key of FILTER_KEYS) {
      const value = key in over ? over[key] : params[key]
      if (value) q.set(key, value)
    }

    if (over.page && over.page > 1) q.set('page', String(over.page))

    const search = q.toString()
    return search ? `/?${search}` : '/'
  }
}
