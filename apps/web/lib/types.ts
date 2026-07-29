/** Wire types for the Pulse API (shaped by the backend's controllers —
 *  user relations are always trimmed to id/documentId/username). */

export type UserRef = { id: number; documentId: string; username: string }
export type TopicRef = { documentId?: string; name: string; slug: string; kind?: string }
export type ChannelRef = { name: string; key?: string }

export type OutcomeResult = 'resolved' | 'positive-turn' | 'no-reaction' | 'escalated'
export type MentionStatus = 'unanswered' | 'claimed' | 'answered' | 'resolved' | 'acknowledged'
export type SentimentLabel = 'positive' | 'neutral' | 'negative' | 'na'
export type CommentKind = 'comment' | 'note' | 'feedback'

export type ResponseRecord = {
  documentId: string
  finalText: string
  draftText?: string | null
  notes?: string | null
  internal?: boolean
  respondedAt?: string
  respondedBy?: UserRef | null
  outcome?: { result: OutcomeResult; notes?: string | null; recordedAt?: string } | null
}

export type CommentEntry = {
  documentId: string
  kind: CommentKind
  body: string
  links?: string[] | null
  createdAt: string
  editedAt?: string | null
  author?: UserRef | null
}

export type ActivityEntry = {
  documentId: string
  action: string
  detail?: Record<string, unknown> | null
  at?: string
  actor?: UserRef | null
}

export type Mention = {
  documentId: string
  externalId: string
  content: string
  authorHandle?: string | null
  url?: string | null
  postedAt?: string | null
  receivedAt?: string | null
  status: MentionStatus
  acknowledgeReason?: string | null
  sentimentLabel?: SentimentLabel | null
  sentimentScore?: number | null
  humanCorrected?: boolean
  modelVersion?: string | null
  promptVersion?: string | null
  draftText?: string | null
  draftedVia?: string | null
  channel?: ChannelRef | null
  topics?: TopicRef[]
  owner?: UserRef | null
  assignee?: UserRef | null
  responses?: ResponseRecord[]
  activities?: ActivityEntry[]
  /** detail API: array; list API: relation count */
  comments?: CommentEntry[] | { count: number }
}

/** list-vs-detail helper: the queue gets a count, the detail page an array */
export const commentCount = (m: Pick<Mention, 'comments'>): number =>
  Array.isArray(m.comments) ? m.comments.length : (m.comments?.count ?? 0)
