/**
 * Wire types for the Pulse API.
 *
 * Shaped by the backend's controllers rather than by the database: user
 * relations are always trimmed to id/documentId/username before they leave
 * Strapi, so that is what the frontend can rely on.
 */

// ── API envelope ────────────────────────────────────────────────────────────

/**
 * Every response from the transport, success or failure.
 *
 * `success` is the discriminant — narrow on it and TypeScript hands you `data`
 * without a `!`. Failures arrive as values rather than exceptions, so a caller
 * that must handle a 401 is told so by the type rather than by a stack trace.
 */
export type TStrapiResponse<T> = {
  data?: T
  meta?: {
    pagination?: TPagination
    /**
     * Whether the server ACTUALLY grouped. It falls back to a flat list when
     * the filtered set is too large to group honestly, so the queue's label
     * has to read this rather than assume it got what it asked for.
     */
    grouped?: boolean
    /** the graph endpoint offers the projections it can render */
    projections?: TGraphProjection[]
  }
  error?: TStrapiError
  success: boolean
  status: number
}

export type TGraphProjection = { id: string; label: string; description: string }

// ── Insights payloads ───────────────────────────────────────────────────────

export type TInsightsConfig = { aiEnabled: boolean }

/** Shapes taken from TrendChart's own props — it is the only consumer. */
export type TTrendPoint = { date: string; score: number | null; volume: number }
export type TTrendEvent = { documentId: string; title: string; date: string; kind: string }
export type TTrendsPayload = { series: TTrendPoint[]; events: TTrendEvent[] }

/**
 * Deliberately permissive, and NOT `any`.
 *
 * The components consuming these (theme-list, the sigma graph, the feedback and
 * snapshot panels) still take untyped props, so a precise payload type here
 * would be a guess that the compiler could not check against its only consumer.
 * Typing each payload belongs with typing the component that renders it.
 */
export type TLooseRecord = Record<string, unknown>

export type TThemesPayload = { windowDays: number; themes: TLooseRecord[] }
export type TGraphPayload = { projection?: string } & TLooseRecord
export type TLeaderboard = { leaders: TLooseRecord[] }

// ── Settings payloads ───────────────────────────────────────────────────────

export type TPreferences = { hideFromLeaderboard: boolean }

export type TAnalysisStatus = {
  enabled: boolean
  provider: string
  model: string
  counts: { missing: number; fallbackOnly: number }
  budget: { spent: number; budget: number; exceeded: boolean }
}

export type TLeadsStatus = {
  scored: number
  hot: number
  warm: number
  lastScoredAt: string | null
  staleCount: number
}

export type TMutedAuthor = { documentId: string; handle: string } & TLooseRecord

/** The lead board and the person page read these; the rest varies by endpoint. */
export type TPerson = {
  documentId: string
  handle?: string | null
  leadScore?: number | null
  leadContext?: { evidence?: string | null; strongestMention?: string | null } | null
  profile?: { started?: boolean; hasEmail?: boolean; company?: string | null } | null
} & TLooseRecord

export type THTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type TRequestOptions = { timeoutMs?: number; authToken?: string }

export type TApiOptions<P = Record<string, unknown>> = TRequestOptions & {
  method: THTTPMethod
  payload?: P
}

export type TPagination = {
  page: number
  pageSize?: number
  pageCount: number
  total: number
}

/** Strapi's own error shape, plus the ones we synthesise for timeout and network. */
export type TStrapiError = {
  status: number
  name: string
  message: string
  details?: unknown
}

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
