/**
 * Wire types for the Pulse API.
 *
 * Shaped by the backend's controllers rather than by the database: user
 * relations are always trimmed to id/documentId/username before they leave
 * Strapi, so that is what the frontend can rely on.
 */

// ── API envelope ────────────────────────────────────────────────────────────

/** What `strapiFetch` resolves to. `meta` is absent on single-entity reads. */
export type TStrapiResponse<T> = {
  data: T
  meta?: {
    pagination?: TPagination
    /**
     * Whether the server ACTUALLY grouped. It falls back to a flat list when
     * the filtered set is too large to group honestly, so the queue's label
     * has to read this rather than assume it got what it asked for.
     */
    grouped?: boolean
  }
}

export type TPagination = {
  page: number
  pageSize?: number
  pageCount: number
  total: number
}

/** An error from `strapiFetch` carrying the HTTP status it failed with. */
export type TStrapiError = Error & { status?: number }

// ── Route params ────────────────────────────────────────────────────────────

/**
 * The queue's URL, as Next hands it over — every value a string, because that
 * is what a query string holds.
 */
export type TQueueSearchParams = {
  status?: string
  sentiment?: string
  topic?: string
  page?: string
  draft?: string
  quality?: string
  topics?: string
  sort?: string
  q?: string
  lane?: string
  awaiting?: string
  every?: string
}

/**
 * Overrides passed to `filterUrl`. Separate from TQueueSearchParams on
 * purpose: `page` is a number here and a string in the URL, and one shared
 * shape would have to lie about one of them.
 */
export type TQueueFilterOverrides = Omit<TQueueSearchParams, 'page'> & { page?: number }

// ── Unions ──────────────────────────────────────────────────────────────────

export type TOutcomeResult = 'resolved' | 'positive-turn' | 'no-reaction' | 'escalated'
export type TMentionStatus = 'unanswered' | 'claimed' | 'answered' | 'resolved' | 'acknowledged'
export type TSentimentLabel = 'positive' | 'neutral' | 'negative' | 'na'
export type TCommentKind = 'comment' | 'note' | 'feedback'
/** respond/lead are reply work; monitor is discourse kept for trends only. */
export type TLane = 'respond' | 'lead' | 'monitor'

// ── Domain ──────────────────────────────────────────────────────────────────

export type TUserRef = { id: number; documentId: string; username: string }
export type TTopicRef = { documentId?: string; name: string; slug: string; kind?: string }
export type TChannelRef = { name: string; key?: string }

export type TResponseRecord = {
  documentId: string
  finalText: string
  draftText?: string | null
  notes?: string | null
  internal?: boolean
  respondedAt?: string
  respondedBy?: TUserRef | null
  outcome?: { result: TOutcomeResult; notes?: string | null; recordedAt?: string } | null
}

export type TCommentEntry = {
  documentId: string
  kind: TCommentKind
  body: string
  links?: string[] | null
  createdAt: string
  editedAt?: string | null
  author?: TUserRef | null
}

export type TActivityEntry = {
  documentId: string
  action: string
  detail?: Record<string, unknown> | null
  at?: string
  actor?: TUserRef | null
}

export type TMention = {
  documentId: string
  externalId: string
  content: string
  authorHandle?: string | null
  url?: string | null
  postedAt?: string | null
  receivedAt?: string | null
  status: TMentionStatus
  acknowledgeReason?: string | null
  sentimentLabel?: TSentimentLabel | null
  sentimentScore?: number | null
  humanCorrected?: boolean
  modelVersion?: string | null
  promptVersion?: string | null
  draftText?: string | null
  draftedVia?: string | null
  quality?: string | null
  lane?: TLane | null
  laneReason?: string | null
  awaitsReply?: boolean
  /** how many messages the row stands for when the queue is grouped */
  threadSize?: number
  channel?: TChannelRef | null
  topics?: TTopicRef[]
  owner?: TUserRef | null
  assignee?: TUserRef | null
  responses?: TResponseRecord[]
  activities?: TActivityEntry[]
  /** detail API: array; list API: relation count */
  comments?: TCommentEntry[] | { count: number }
}
