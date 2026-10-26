'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { BookmarkPlus, Check, Search, SlidersHorizontal } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { blogFilterParams, DEFAULT_EXCLUDED_CATEGORIES, type TBlogFilters } from '@/lib/blog-filters'
import { Spinner } from '@/components/ui'
import { MutationError } from '@/components/ui/mutation-error'
import type { TBlogSearchResult } from '@/types'

type Result = {
  ok: boolean
  status?: number
  error: string | null
  results: TBlogSearchResult[]
  pageCount: number
  total: number
  /** results on this page the filters removed */
  hidden: number
  categories: string[]
} | null

/**
 * Live search of the marketing blog, to find posts worth saving.
 *
 * Search runs on the server from the URL (the page loads it), so this
 * component only owns the box and the Save buttons. Results are not stored
 * anywhere until someone clicks Save.
 */
export default function BlogSearch({
  q,
  page,
  filters,
  result,
}: {
  q: string
  page: number
  filters: TBlogFilters
  result: Result
}) {
  const router = useRouter()
  const [value, setValue] = useState(q)
  const [pending, startTransition] = useTransition()

  const go = (next: string, nextPage = 1, nextFilters: TBlogFilters = filters) => {
    const params = new URLSearchParams({ view: 'find', ...blogFilterParams(nextFilters) })
    if (next.trim()) params.set('q', next.trim())
    if (nextPage > 1) params.set('page', String(nextPage))
    startTransition(() => router.push(`/resources?${params}`))
  }
  const setFilters = (patch: Partial<TBlogFilters>) => go(q, 1, { ...filters, ...patch })
  // categories are only known once a search has come back; keep the excluded
  // ones visible even when this page had none, so they can be turned back on
  const categories = [...new Set([...(result?.categories ?? []), ...filters.exclude])].sort()

  return (
    <div>
      <form
        className="relative mb-4"
        onSubmit={(e) => {
          e.preventDefault()
          go(value)
        }}
      >
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search the blog — title, description or article text, then Enter"
          aria-label="Search the marketing blog"
          className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-10 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {pending && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner size={14} />
          </span>
        )}
      </form>

      <BlogFilterBar filters={filters} categories={categories} onChange={setFilters} disabled={pending} />

      {!q ? (
        <p className="text-sm text-zinc-500">
          Search for the topic people ask about — “webhooks”, “i18n”, “MCP”. Matches in the title are
          listed first.
        </p>
      ) : q.length < 2 ? (
        <p className="text-sm text-zinc-500">Type at least two characters.</p>
      ) : !result ? null : !result.ok ? (
        <SearchError status={result.status} message={result.error} />
      ) : result.results.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {result.hidden > 0
            ? `${result.hidden} post${result.hidden === 1 ? '' : 's'} on this page matched “${q}” but the filters hid them.`
            : `No published posts match “${q}” with these filters.`}
          {result.pageCount > page && ' Try the next page, or loosen the filters.'}
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-500">
            {result.total} post{result.total === 1 ? '' : 's'} on the blog match “{q}”
            {result.hidden > 0 && <> · {result.hidden} on this page hidden by the filters</>}
          </p>
          <ul className="space-y-3">
            {result.results.map((post) => (
              <BlogResult key={post.sourceId} post={post} />
            ))}
          </ul>
          {result.pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                onClick={() => go(q, page - 1)}
                disabled={page <= 1 || pending}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
              >
                ← Newer
              </button>
              <span className="text-xs text-zinc-500">
                Page {page} of {result.pageCount}
              </span>
              <button
                onClick={() => go(q, page + 1)}
                disabled={page >= result.pageCount || pending}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
              >
                Older →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SearchError({ status, message }: { status?: number; message: string | null }) {
  if (status === 503) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        Blog search isn&apos;t set up. Set <code>MARKETING_MCP_URL</code> and <code>MARKETING_MCP_TOKEN</code> in the
        CMS environment — a marketing-site admin token granted only the list/get blog tools.
      </div>
    )
  }
  return (
    <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
      {message ?? 'The marketing site did not answer.'}
    </p>
  )
}

function BlogResult({ post }: { post: TBlogSearchResult }) {
  const router = useRouter()
  const save = useMutation({
    mutationFn: () => pulseFetch('POST', 'resources', { sourceId: post.sourceId }),
    onSuccess: () => router.refresh(),
  })
  const saved = Boolean(post.savedId) || save.isSuccess

  return (
    <li data-testid="blog-result" className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <a
          href={post.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 basis-64 font-medium text-blue-600 hover:underline [overflow-wrap:anywhere]"
        >
          {post.title} ↗
        </a>
        {saved ? (
          <Link
            href="/resources"
            className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 max-sm:min-h-[38px] max-sm:px-3 dark:bg-emerald-950/40 dark:text-emerald-300"
            title="Already in your saved resources"
          >
            <Check size={12} /> Saved
          </Link>
        ) : (
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-[#4945FF] to-[#7B79FF] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60 max-sm:min-h-[38px] max-sm:px-3"
          >
            {save.isPending ? <Spinner size={12} /> : <BookmarkPlus size={12} />} Save
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-zinc-500">
        {[post.category, post.level, post.postedAt && new Date(post.postedAt).toLocaleDateString()].filter(Boolean).join(' · ')}
        {post.version && (
          <span
            className={`ml-2 rounded px-1 py-px text-[11px] font-medium ${
              post.version === 'v5'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
            }`}
            title={post.version === 'v5' ? 'Written for Strapi 5' : `Written for Strapi ${post.version} — check it still applies`}
          >
            {post.version}
          </span>
        )}
      </p>
      {post.summary && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{post.summary}</p>}
      {post.keywords && post.keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {post.keywords.slice(0, 6).map((k) => (
            <span key={k} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {k}
            </span>
          ))}
        </div>
      )}
      <MutationError m={save} className="mt-2 text-xs" />
    </li>
  )
}

function BlogFilterBar({
  filters,
  categories,
  onChange,
  disabled,
}: {
  filters: TBlogFilters
  categories: string[]
  onChange: (patch: Partial<TBlogFilters>) => void
  disabled: boolean
}) {
  const pill = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs disabled:opacity-50 max-sm:min-h-[32px] ${
      active
        ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
        : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400'
    }`
  const ages: { key: TBlogFilters['age']; label: string }[] = [
    { key: '1y', label: 'last year' },
    { key: '2y', label: 'last 2 years' },
    { key: 'all', label: 'any time' },
  ]
  const toggleCategory = (c: string) =>
    onChange({ exclude: filters.exclude.includes(c) ? filters.exclude.filter((x) => x !== c) : [...filters.exclude, c] })
  const isDefault =
    filters.age === '2y' &&
    !filters.showOld &&
    filters.exclude.length === DEFAULT_EXCLUDED_CATEGORIES.length &&
    DEFAULT_EXCLUDED_CATEGORIES.every((c) => filters.exclude.includes(c))

  return (
    <div className="mb-4 space-y-2 rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800" aria-label="Blog search filters" role="group">
      <div className="flex flex-wrap items-center gap-1.5">
        <SlidersHorizontal size={12} className="text-zinc-400" aria-hidden />
        <span className="mr-1 text-zinc-500">Published</span>
        {ages.map((a) => (
          <button key={a.key} disabled={disabled} onClick={() => onChange({ age: a.key })} className={pill(filters.age === a.key)} aria-pressed={filters.age === a.key}>
            {a.label}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            disabled={disabled}
            checked={!filters.showOld}
            onChange={(e) => onChange({ showOld: !e.target.checked })}
          />
          Hide posts written for Strapi v3/v4
        </label>
        {!isDefault && (
          <button
            disabled={disabled}
            onClick={() => onChange({ age: '2y', showOld: false, exclude: DEFAULT_EXCLUDED_CATEGORIES })}
            className="ml-auto text-zinc-500 underline underline-offset-2"
          >
            Reset filters
          </button>
        )}
      </div>
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-zinc-500">Categories</span>
          {categories.map((c) => {
            const on = !filters.exclude.includes(c)
            return (
              <button
                key={c}
                disabled={disabled}
                onClick={() => toggleCategory(c)}
                className={pill(on)}
                aria-pressed={on}
                title={on ? `Hide ${c} posts` : `Show ${c} posts`}
              >
                {c}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
