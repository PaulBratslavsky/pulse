'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'

/**
 * Themes list: search, kind filter and paging, all client-side.
 *
 * The whole ranked set is already in memory (~100 topics), so filtering as you
 * type costs nothing and a Search button would just be friction. The query is
 * mirrored into the URL with replaceState so a filtered view stays linkable
 * and survives a reload, without a server round-trip per keystroke.
 */

const PER_PAGE = 20
const KINDS = ['competitor', 'feature', 'bug', 'docs', 'other'] as const

export default function ThemeList({
  themes,
  initialQuery,
  initialKind,
}: {
  themes: any[]
  initialQuery: string
  initialKind: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [kind, setKind] = useState(initialKind)
  const [page, setPage] = useState(1)

  const syncUrl = (q: string, k: string) => {
    const sp = new URLSearchParams(window.location.search)
    q ? sp.set('q', q) : sp.delete('q')
    k ? sp.set('kind', k) : sp.delete('kind')
    const s = sp.toString()
    window.history.replaceState(null, '', s ? `/themes?${s}` : '/themes')
  }

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      themes.filter(
        (t) => (!q || t.topic.name.toLowerCase().includes(q)) && (!kind || t.topic.kind === kind)
      ),
    [themes, q, kind]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const current = Math.min(page, pageCount)
  const shown = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE)

  return (
    <div>
      <div className="relative mb-3">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1) // a new filter invalidates the page you were on
            syncUrl(e.target.value.trim(), kind)
          }}
          placeholder="Search themes…"
          aria-label="Search themes"
          className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {(['', ...KINDS] as const).map((k) => (
          <button
            key={k || 'all'}
            onClick={() => {
              setKind(k)
              setPage(1)
              syncUrl(q, k)
            }}
            className={`inline-flex items-center rounded-full border px-3 py-1 max-sm:min-h-[38px] max-sm:px-3.5 ${
              kind === k
                ? 'border-zinc-900 font-medium dark:border-white'
                : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'
            }`}
          >
            {k || 'all kinds'}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500" data-testid="themes-count">
          {filtered.length} {filtered.length === 1 ? 'theme' : 'themes'}
          {filtered.length !== themes.length && ` of ${themes.length}`}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="mb-1 text-lg font-medium">
            {q || kind ? 'Nothing matches' : 'No themes yet'}
          </p>
          <p className="mx-auto max-w-md text-sm text-zinc-500">
            {q || kind
              ? 'Try a different search or clear the filters.'
              : 'Themes appear once analyzed mentions accumulate topics. Greenfield data — give it a few days.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((t: any) => (
            <li
              key={t.topic.slug}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">#{t.topic.name}</span>
                <span className="text-xs text-zinc-500">{t.topic.kind}</span>
                <span className="text-sm">{t.mentions} mentions</span>
                <span
                  className={`text-sm font-medium ${
                    t.negativeShare >= 50 ? 'text-red-600' : 'text-zinc-500'
                  }`}
                >
                  {t.negativeShare}% negative
                </span>
                <span className="text-sm text-zinc-500">avg score {t.avgScore}</span>
                {/* filters the queue by THIS topic — it used to link to
                    ?sentiment=negative, showing every negative mention no
                    matter which theme you clicked */}
                <Link
                  href={`/?topic=${encodeURIComponent(t.topic.slug)}`}
                  className="ml-auto text-sm text-blue-600 hover:underline"
                >
                  view queue →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            onClick={() => setPage(current - 1)}
            disabled={current === 1}
            className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:invisible dark:border-zinc-700"
          >
            ← Previous
          </button>
          <span className="text-zinc-500">
            Page {current} of {pageCount}
          </span>
          <button
            onClick={() => setPage(current + 1)}
            disabled={current === pageCount}
            className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:invisible dark:border-zinc-700"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
