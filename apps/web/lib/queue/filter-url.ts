import type { TQueueFilterOverrides, TQueueSearchParams } from '@/types'

/**
 * Every filter that survives a link, in the order the original set them — so a
 * URL built from the same state is byte-identical to the pre-refactor one.
 *
 * `awaiting` is deliberately absent, matching the original exactly: it was
 * declared in the override type and then never read or written, so the
 * "awaiting reply" pill has always linked to a URL without it. Fixing that is
 * a behaviour change and gets its own commit; this one stays a pure refactor.
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
