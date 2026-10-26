import type { Core } from '@strapi/strapi'
import { createMCPClient } from '@ai-sdk/mcp'

/**
 * The marketing site, as a place to FIND posts — never a place Pulse writes to.
 *
 * Pulse does not mirror the blog. The team searches it live, picks the posts
 * worth sending people to, and saves those as Pulse's own `resource` records
 * (api::resource.resource). This adapter is the only code that talks to the
 * marketing site.
 *
 * Source: the marketing Strapi's built-in MCP server. Every `list_blog-post`
 * result carries the full article body and there is no field selection, so
 * results are mapped down to what Pulse needs before they leave this file —
 * bodies never reach the browser or the database.
 *
 * Read-only by construction AND by check: only `list_*` / `get_*` tools are
 * called, and a token that can see write tools is refused outright. Pulse has
 * no business holding a key that can edit the marketing site.
 *
 * Unconfigured (no MARKETING_MCP_URL / MARKETING_MCP_TOKEN) → `configured()` is
 * false and callers degrade; local dev and e2e never touch the real site.
 */

const LIST_POSTS = 'list_blog-post'
const GET_POST = 'get_blog-post'
const LIST_CATEGORIES = 'list_blog-category'
const LIST_TAGS = 'list_blog-tag'
const WRITE_TOOL = /^(create|update|delete|publish|unpublish|discard)_/
const CALL_TIMEOUT_MS = 30_000
const SEARCH_TEXT_BODY = 2000
const LOOKUP_TTL_MS = 6 * 60 * 60 * 1000

export type SourcePost = {
  kind: 'blog'
  sourceId: string
  title: string
  url: string
  summary: string | null
  keywords: string[]
  category: string | null
  postedAt: string | null
  sourceUpdatedAt: string | null
  /** lowercased title + summary + keywords + the start of the body; stored, never sent to the browser */
  searchText: string
}

// Categories and tags are small and rarely change; posts reference them by
// documentId only. Cached per process so a search is one round trip, not three.
let lookups: { at: number; categories: Map<string, string>; tags: Map<string, string> } | null = null

export const source = ({ strapi }: { strapi: Core.Strapi }) => {
  const configured = () => Boolean(process.env.MARKETING_MCP_URL && process.env.MARKETING_MCP_TOKEN)

  /**
   * Open a client, check the token is read-only, run `fn`, always close.
   *
   * Every failure in here is the marketing site's (or the token's), so it
   * leaves as a SourceError — callers map that to a 502 and let anything else
   * (our own database) surface as what it is. Startup and tool discovery are
   * bounded by the same deadline as tool calls: a server that accepts the
   * connection and then goes quiet must not hang a search forever.
   */
  async function withClient<T>(fn: (client: any, tools: string[]) => Promise<T>): Promise<T> {
    if (!configured()) throw new SourceNotConfigured()
    let client: any
    try {
      client = await createMCPClient({
        transport: {
          type: 'http',
          url: process.env.MARKETING_MCP_URL!,
          headers: { Authorization: `Bearer ${process.env.MARKETING_MCP_TOKEN}` },
        },
        initializationOptions: { timeout: CALL_TIMEOUT_MS },
        clientName: 'pulse-resources',
      })
      const tools = await toolNames(client)
      const writable = tools.filter((n) => WRITE_TOOL.test(n))
      if (writable.length) {
        throw new SourceError(
          `the marketing MCP token can see write tools (${writable.slice(0, 3).join(', ')}${writable.length > 3 ? ', …' : ''}). ` +
            `Grant it only the list/get blog tools.`
        )
      }
      if (!tools.includes(LIST_POSTS)) throw new SourceError(`the marketing MCP token cannot see ${LIST_POSTS}`)
      return await fn(client, tools)
    } catch (err: any) {
      throw err instanceof SourceError ? err : new SourceError(String(err?.message ?? err))
    } finally {
      await client?.close().catch(() => {})
    }
  }

  async function names(client: any, tools: string[]) {
    if (lookups && Date.now() - lookups.at < LOOKUP_TTL_MS) return lookups
    const categories = tools.includes(LIST_CATEGORIES) ? await nameMap(client, LIST_CATEGORIES) : new Map()
    const tags = tools.includes(LIST_TAGS) ? await nameMap(client, LIST_TAGS) : new Map()
    lookups = { at: Date.now(), categories, tags }
    return lookups
  }

  return {
    configured,

    /**
     * Search published posts by title, description or body. Substring match —
     * the source has no relevance ranking — so title hits are listed first.
     */
    async search(q: string, { page = 1, pageSize = 10 }: { page?: number; pageSize?: number } = {}) {
      const term = q.trim()
      if (!term) return { results: [] as SourcePost[], pagination: { page: 1, pageSize, pageCount: 0, total: 0 } }
      return withClient(async (client, tools) => {
        const res = await call(client, LIST_POSTS, {
          status: 'published',
          page,
          pageSize: Math.min(Math.max(pageSize, 1), 25),
          sort: 'originalPublishedAt:desc',
          filters: {
            $or: [
              { title: { $containsi: term } },
              { description: { $containsi: term } },
              { content: { $containsi: term } },
            ],
          },
        })
        const { categories, tags } = await names(client, tools)
        const needle = term.toLowerCase()
        const results = ((res?.results ?? []) as any[])
          .map((p) => toSourcePost(p, categories, tags))
          .filter(Boolean) as SourcePost[]
        // stable: title matches first, otherwise newest first as the source sorted them
        results.sort((a, b) => Number(b.title.toLowerCase().includes(needle)) - Number(a.title.toLowerCase().includes(needle)))
        return { results, pagination: res?.pagination ?? { page, pageSize, pageCount: 0, total: results.length } }
      })
    },

    /** One published post, or null when it is gone (unpublished or deleted upstream). */
    async get(sourceId: string): Promise<SourcePost | null> {
      return (await this.getMany([sourceId], { strict: true })).get(sourceId) ?? null
    },

    /**
     * Several posts by id, over ONE connection — used by the refresh job.
     * A post that is gone maps to null; a post that merely failed to load is
     * left OUT of the map (so a network blip never reads as "unpublished"),
     * or throws when `strict`.
     */
    async getMany(sourceIds: string[], { strict = false } = {}): Promise<Map<string, SourcePost | null>> {
      const out = new Map<string, SourcePost | null>()
      if (!sourceIds.length) return out
      await withClient(async (client, tools) => {
        if (!tools.includes(GET_POST)) throw new Error(`the marketing MCP token cannot see ${GET_POST}`)
        const { categories, tags } = await names(client, tools)
        for (const id of sourceIds) {
          try {
            const res = await call(client, GET_POST, { documentId: id, status: 'published' })
            const post = res?.data ?? res
            out.set(id, post?.documentId ? toSourcePost(post, categories, tags) : null)
          } catch (err: any) {
            if (/not ?found|404/i.test(String(err.message))) out.set(id, null)
            else if (strict) throw err
            else strapi.log.warn(`[resources] could not load ${id}: ${err.message}`)
          }
        }
      })
      return out
    },
  }
}

export class SourceNotConfigured extends Error {
  constructor() {
    super('Blog search is not configured (MARKETING_MCP_URL / MARKETING_MCP_TOKEN)')
  }
}

/** The marketing site failed or refused us — as opposed to a failure on Pulse's side. */
export class SourceError extends Error {}

// ---- MCP plumbing ---------------------------------------------------------

async function toolNames(client: any): Promise<string[]> {
  const names: string[] = []
  let cursor: string | undefined
  do {
    const res = await client.listTools({
      params: cursor ? { cursor } : undefined,
      options: { timeout: CALL_TIMEOUT_MS },
    })
    for (const t of res.tools ?? []) names.push(t.name)
    cursor = res.nextCursor
  } while (cursor)
  return names
}

async function call(client: any, name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({
    name,
    arguments: args,
    options: { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) },
  })
  const text = (res.content ?? []).find((c: any) => c.type === 'text')?.text
  if (res.isError) throw new Error(`${name}: ${String(text ?? 'tool error').slice(0, 300)}`)
  if (res.structuredContent) return res.structuredContent
  try {
    return text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${name}: response was not JSON`)
  }
}

/** documentId → name, for the small lookup collections (categories, tags). */
async function nameMap(client: any, tool: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let page = 1; page <= 20; page++) {
    const res = await call(client, tool, { status: 'published', page, pageSize: 100 })
    for (const row of res?.results ?? []) if (row.documentId && row.name) map.set(row.documentId, row.name)
    if (page >= (res?.pagination?.pageCount ?? 0)) break
  }
  return map
}

// ---- mapping --------------------------------------------------------------

const BLOG_BASE = () => (process.env.MARKETING_BLOG_BASE_URL || 'https://strapi.io/blog').replace(/\/+$/, '')

export function toSourcePost(post: any, categories: Map<string, string>, tags: Map<string, string>): SourcePost | null {
  if (!post?.documentId || !post?.title || !post?.slug) return null

  const category = post.category?.documentId ? categories.get(post.category.documentId) ?? null : null
  const tagNames = (post.tags ?? []).map((t: any) => tags.get(t.documentId)).filter(Boolean) as string[]
  const seoKeywords = String(post.seo?.keywords ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  const keywords = dedupe([...seoKeywords, ...tagNames, ...(category ? [category] : [])])

  const summary =
    clean(post.description) || clean(post.seo?.metaDescription) || firstParagraph(String(post.content ?? '')) || null

  const body = plain(String(post.content ?? '')).slice(0, SEARCH_TEXT_BODY)
  const searchText = [post.title, summary, keywords.join(' '), body].filter(Boolean).join('\n').toLowerCase()

  return {
    kind: 'blog',
    sourceId: String(post.documentId),
    title: String(post.title).trim(),
    url: blogUrl(post),
    summary,
    keywords,
    category,
    postedAt: post.originalPublishedAt ?? post.publishedAt ?? null,
    sourceUpdatedAt: post.updatedAt ?? null,
    searchText,
  }
}

/** The canonical URL when it points at the blog, else the slug on the blog base. */
function blogUrl(post: any): string {
  const canonical = String(post.seo?.canonicalURL ?? '').trim()
  if (canonical.startsWith(`${BLOG_BASE()}/`)) return canonical
  return `${BLOG_BASE()}/${post.slug}`
}

function clean(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''
}

/** Markdown → roughly plain words, good enough for matching. */
function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, ' ') // list markers
    .replace(/^\s*-{3,}\s*$/gm, ' ') // horizontal rules
    .replace(/[#>*_`|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstParagraph(md: string): string {
  const para = md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(#|!\[|```|\||<|[-*] )/.test(p))
  return para ? plain(para).slice(0, 300) : ''
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>()
  return list.filter((k) => {
    const key = k.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export default source
