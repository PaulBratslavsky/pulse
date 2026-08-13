import { redirect } from 'next/navigation'

import { isAuthError, loaders } from '@/lib/loaders'
import type { TMention, TQueueSearchParams, TStrapiResponse } from '@/types'

/**
 * The queue's mentions, grouped by conversation where the server can manage it.
 *
 * `group` is a param only the newer CMS understands, and `strictParams` makes an
 * older one reject the whole request with a 400 rather than ignore it. The
 * frontend deploys in a minute and the CMS takes several, so there is always a
 * window where this queue talks to a backend that predates it — and without the
 * retry the queue is a 500 for the length of that window. Falls back to the flat
 * list, which is a worse view, not a broken page.
 *
 * Failures arrive as values now, so the retry is an `if` rather than a catch.
 * `redirect()` still throws a sentinel to unwind the render — it is called
 * outside any try block here, so nothing can swallow it.
 */
export async function fetchQueue(
  params: TQueueSearchParams,
  page: number
): Promise<TStrapiResponse<TMention[]>> {
  const wantGrouped = !params.every

  let res = await loaders.getQueue(params, page, wantGrouped)
  if (isAuthError(res)) redirect('/sign-in')

  if (!res.success && wantGrouped) {
    // only the grouping could have caused this — retry without it
    res = await loaders.getQueue(params, page, false)
    if (isAuthError(res)) redirect('/sign-in')
  }

  if (!res.success) throw new Error(res.error?.message ?? 'failed to load the queue')
  return res
}
