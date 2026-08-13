import { redirect } from 'next/navigation'
import qs from 'qs'

import { strapiFetch } from '@/lib/strapi'
import { buildQueueQuery } from '@/lib/queue/query'
import type { TMention, TQueueSearchParams, TStrapiError, TStrapiResponse } from '@/types'

/** A 401/403 from strapiFetch means the session is gone, not that the query was wrong. */
export function isAuthError(err: unknown): boolean {
  const status = (err as TStrapiError)?.status
  return status === 401 || status === 403
}

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
 * `redirect()` unwinds the render by throwing a sentinel, so both catch blocks
 * rethrow anything they do not handle. Swallowing here would turn a expired
 * session into a blank page instead of a trip to sign-in.
 */
export async function fetchQueue(
  params: TQueueSearchParams,
  page: number
): Promise<TStrapiResponse<TMention[]>> {
  // encodeValuesOnly so the brackets stay readable in a log or a network tab —
  // Strapi parses either form, and an unreadable URL costs an hour the first
  // time a filter misbehaves.
  const get = (grouped: boolean) =>
    strapiFetch<TStrapiResponse<TMention[]>>(
      '/api/mentions?' +
        qs.stringify(buildQueueQuery(params, page, grouped), { encodeValuesOnly: true })
    )

  const wantGrouped = !params.every

  try {
    return await get(wantGrouped)
  } catch (err) {
    if (isAuthError(err)) redirect('/sign-in')
    if (!wantGrouped) throw err
    // only the grouping could have caused this — retry without it
    return await get(false).catch((e: unknown) => {
      if (isAuthError(e)) redirect('/sign-in')
      throw e
    })
  }
}
