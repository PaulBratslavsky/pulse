import type { TMention } from '@/types'

/** list-vs-detail helper: the queue gets a count, the detail page an array */
export const commentCount = (m: Pick<TMention, 'comments'>): number =>
  Array.isArray(m.comments) ? m.comments.length : (m.comments?.count ?? 0)
