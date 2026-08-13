import { cookies } from 'next/headers'
import qs from 'qs'

import { api } from '@/lib/data-api'
import { buildQueueQuery } from '@/lib/queue/query'
import type {
  TAnalysisStatus,
  TGraphPayload,
  TInsightsConfig,
  TLeaderboard,
  TLeadsStatus,
  TMention,
  TMutedAuthor,
  TPerson,
  TPreferences,
  TQueueSearchParams,
  TStrapiResponse,
  TThemesPayload,
  TTopicRef,
  TTrendsPayload,
  TUserRef,
} from '@/types'

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1338'

/**
 * The session token, read per request.
 *
 * NOT a module constant: Pulse authenticates per user from an httpOnly cookie,
 * and a module-level value is evaluated once per process — it would either be
 * empty or pin one user's token across every render the server handles.
 *
 * Reading cookies() also opts the route out of static rendering, which is
 * correct: every page here is per-user and must never be cached across sessions.
 */
async function authToken(): Promise<string | undefined> {
  return (await cookies()).get('pulse_jwt')?.value
}

/**
 * `new URL` rather than concatenation: it normalises double slashes and fails
 * loudly at the seam if the base is missing, instead of producing a 404 three
 * layers away. `encodeValuesOnly` keeps brackets readable in a log.
 */
function strapiUrl(path: string, query?: Record<string, unknown>): string {
  const url = new URL(path, STRAPI_URL)
  if (query) url.search = qs.stringify(query, { encodeValuesOnly: true })
  return url.href
}

/** A 401/403 means the session is gone, not that the query was wrong. */
export function isAuthError(res: TStrapiResponse<unknown>): boolean {
  return res.status === 401 || res.status === 403
}

const get = async <T>(path: string, query?: Record<string, unknown>) =>
  api.get<T>(strapiUrl(path, query), { authToken: await authToken() })

// ── Session ─────────────────────────────────────────────────────────────────

const getMe = () => get<TUserRef>('/api/users/me')

// ── Queue and mentions ──────────────────────────────────────────────────────

/**
 * `grouped` is a parameter rather than read from params because the caller
 * retries with it off — an older CMS 400s on the `group` param, and the deploy
 * window where the frontend is ahead of the backend must degrade to a flat list
 * rather than a 500. See lib/queue/fetch.ts.
 */
const getQueue = (params: TQueueSearchParams, page: number, grouped: boolean) =>
  get<TMention[]>('/api/mentions', buildQueueQuery(params, page, grouped))

/** The rail's "needs attention" list: oldest unanswered, spam excluded. */
const getUnansweredPreview = () =>
  get<TMention[]>('/api/mentions', {
    filters: {
      status: { $eq: 'unanswered' },
      // the queue excludes confirmed spam; this rail forgot to, so muted
      // authors kept surfacing under "Needs attention" — the one place
      // that asserts something needs a human
      quality: { $ne: 'spam' },
    },
    sort: 'postedAt:asc',
    pagination: { pageSize: 5 },
  })

const getMention = (id: string) => get<TMention>(`/api/mentions/${id}`)

const getMentionThread = (id: string) => get<TMention[]>(`/api/mentions/${id}/thread`)

// ── People and leads ────────────────────────────────────────────────────────

const getLeads = (query: Record<string, unknown>) => get<TPerson[]>('/api/people/leads', query)

const getPeople = (query: Record<string, unknown>) => get<TPerson[]>('/api/people', query)

const getPerson = (documentId: string) => get<TPerson>(`/api/people/${documentId}`)

const getLeadsStatus = () => get<TLeadsStatus>('/api/people/leads-status')

// ── Insights ────────────────────────────────────────────────────────────────

const getInsightsConfig = () => get<TInsightsConfig>('/api/insights/config')

const getTrends = (query: Record<string, unknown>) =>
  get<TTrendsPayload>('/api/insights/trends', query)

const getThemes = (query: Record<string, unknown>) =>
  get<TThemesPayload>('/api/insights/themes', query)

const getGraph = (query: Record<string, unknown>) => get<TGraphPayload>('/api/insights/graph', query)

const getSnapshot = (days: number) => get<unknown>('/api/insights/snapshot', { days })

const getFeedback = (days: number, topic?: string) =>
  get<unknown>('/api/insights/feedback', { days, ...(topic ? { topic } : {}) })

const getLeaderboard = (days: number) => get<TLeaderboard>('/api/insights/leaderboard', { days })

// ── Settings ────────────────────────────────────────────────────────────────

const getMutedAuthors = () =>
  get<TMutedAuthor[]>('/api/muted-authors', {
    sort: 'updatedAt:desc',
    pagination: { pageSize: 100 },
  })

const getMyPreferences = () => get<TPreferences>('/api/preferences/me')

const getAnalysisStatus = () => get<TAnalysisStatus>('/api/analysis/status')

const getMcpServers = () => get<unknown[]>('/api/mcp-servers')

// ── Topics ──────────────────────────────────────────────────────────────────

/**
 * Every topic, not the first hundred.
 *
 * Both callers asked for `pageSize=100` and treated the answer as the whole
 * vocabulary. `maxLimit: 100` in the CMS config makes that the ceiling, so the
 * moment the 101st topic was created the picker silently stopped seeing the
 * tail of the alphabet — and a picker that cannot find "Webflow" offers to
 * CREATE it, forking the vocabulary it exists to protect. Silent, and worse the
 * longer it runs.
 *
 * Pages to exhaustion, with a stop so a bad pageCount cannot spin forever.
 * Returns a bare array rather than an envelope: callers all want "the topics",
 * and a partial page is still usable.
 */
async function getAllTopics(): Promise<TTopicRef[]> {
  const out: TTopicRef[] = []
  for (let page = 1; page <= 20; page++) {
    const res = await get<TTopicRef[]>('/api/topics', {
      pagination: { pageSize: 100, page },
      sort: 'name:asc',
    })
    if (!res.success) break
    out.push(...(res.data ?? []))
    if (page >= (res.meta?.pagination?.pageCount ?? 1)) break
  }
  return out
}

export const loaders = {
  getMe,
  getQueue,
  getUnansweredPreview,
  getMention,
  getMentionThread,
  getLeads,
  getPeople,
  getPerson,
  getLeadsStatus,
  getInsightsConfig,
  getTrends,
  getThemes,
  getGraph,
  getSnapshot,
  getFeedback,
  getLeaderboard,
  getMutedAuthors,
  getMyPreferences,
  getAnalysisStatus,
  getMcpServers,
  getAllTopics,
}
