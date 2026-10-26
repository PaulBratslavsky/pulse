import type { Core } from '@strapi/strapi'

/**
 * Which SAVED resources fit a mention — the "Related resources" panel, and the
 * drafter's suggestions later (phase 4).
 *
 * Keyword scoring, no model call: it runs every time a mention page opens, so
 * it must be free, instant and the same answer twice. The corpus is small by
 * design (only what the team chose to save), which is what makes a plain score
 * over every row good enough.
 *
 *   title ×3 · keyword ×2 · body (searchText) ×1, per distinct mention term
 *   + 3 when a whole multi-word keyword appears in the mention ("rest api")
 *   + 1 for pinned, only once something already matched
 *
 * Hidden and unpublished-upstream resources are never suggested: hiding means
 * "stop suggesting this", and a post that may 404 is a bad thing to hand out.
 */

const UID = 'api::resource.resource'
const MIN_SCORE = 3 // one title hit, or a keyword plus a body hit — below that it's coincidence

const STOPWORDS = new Set(
  (
    'the and for are but not you your yours with this that these those from have has had was were will would ' +
    'can could should what when where which who why how all any some just like into onto than then them they ' +
    'their there here its it’s it\'s our ours out about over also been being does did doing done get got very ' +
    'more most much many such only own same too use used using want need know think anyone someone something ' +
    'really still even ever every make made way yes yeah thanks thank please help one two new now via etc ' +
    // everything we save is about Strapi; matching on it would rank every post
    'strapi cms headless'
  ).split(/\s+/)
)

export type ResourceMatch = {
  documentId: string
  title: string
  url: string
  summary: string | null
  note: string | null
  category: string | null
  pinned: boolean
  score: number
  /** the mention terms that matched, for "why this one" */
  matched: string[]
}

export const match = ({ strapi }: { strapi: Core.Strapi }) => ({
  async forMention(documentId: string, limit = 5): Promise<ResourceMatch[] | null> {
    const mention: any = await strapi.documents('api::mention.mention').findOne({
      documentId,
      fields: ['content', 'matchedKeywords'] as any,
      populate: { topics: { fields: ['name'] } } as any,
    })
    if (!mention) return null

    const text = [
      mention.content ?? '',
      ...(Array.isArray(mention.matchedKeywords) ? mention.matchedKeywords.map((k: any) => k?.keyword ?? k) : []),
      ...(mention.topics ?? []).map((t: any) => t.name),
    ].join(' ')

    // private searchText is only readable through the query engine
    const rows = (await strapi.db.query(UID).findMany({
      where: { hidden: false, upstreamMissing: false },
      select: ['documentId', 'title', 'url', 'summary', 'note', 'category', 'pinned', 'keywords', 'searchText'],
      limit: 1000,
    })) as any[]

    return rankResources(text, rows).slice(0, limit)
  },
})

/** Pure, so it can be reasoned about (and tested) without a database. */
export function rankResources(mentionText: string, rows: any[]): ResourceMatch[] {
  const terms = new Set(tokens(mentionText))
  if (!terms.size) return []
  const haystack = ` ${normalise(mentionText)} `

  const scored: ResourceMatch[] = []
  for (const r of rows) {
    const title = new Set(tokens(r.title ?? ''))
    const keywords: string[] = Array.isArray(r.keywords) ? r.keywords.map(String) : []
    const keywordTokens = new Set(tokens(keywords.join(' ')))
    const body = new Set(tokens(r.searchText ?? ''))

    let score = 0
    const matched: string[] = []
    for (const t of terms) {
      const s = (title.has(t) ? 3 : 0) + (keywordTokens.has(t) ? 2 : 0) + (body.has(t) ? 1 : 0)
      if (s) {
        score += s
        matched.push(t)
      }
    }
    for (const k of keywords) {
      const phrase = normalise(k)
      if (phrase.includes(' ') && haystack.includes(` ${phrase} `)) score += 3
    }
    if (score && r.pinned) score += 1
    if (score < MIN_SCORE) continue

    scored.push({
      documentId: r.documentId,
      title: r.title,
      url: r.url,
      summary: r.summary ?? null,
      note: r.note ?? null,
      category: r.category ?? null,
      pinned: Boolean(r.pinned),
      score,
      matched: matched.slice(0, 6),
    })
  }
  return scored.sort((a, b) => b.score - a.score || Number(b.pinned) - Number(a.pinned))
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9.+#\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lowercased words of 3+ characters, stopwords out, a light plural fold ("webhooks" → "webhook", "apis" → "api"; not "class", "status", "analysis"). */
function tokens(s: string): string[] {
  return normalise(s)
    .split(/[\s-]+/)
    .map((w) => w.replace(/^[.+#]+|[.]+$/g, ''))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && /[^su]s$/.test(w) && !w.endsWith('sis') ? w.slice(0, -1) : w))
}

export default match
