'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, CornerDownLeft, Pin, Search } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { Spinner } from '@/components/ui'
import { useReplyDraft } from '@/components/reply/reply-draft-context'
import type { TResource } from '@/types'

type Match = Pick<TResource, 'documentId' | 'title' | 'url' | 'summary' | 'note' | 'category' | 'pinned'> & {
  score?: number
  matched?: string[]
}

/**
 * Saved resources that fit this mention, one click from the reply.
 *
 * Only ever the team's SAVED posts — never the whole blog — so what is offered
 * here is something someone already decided is worth sending. Insert is a
 * human action and an undoable one: nothing here writes into the reply on its
 * own, which is the line the drafter will hold too (it may suggest, never link).
 *
 * The search box covers the miss: keyword matching will not always find the
 * right post, and the person replying often knows which one they want.
 */
export function RelatedResources({ documentId }: { documentId: string }) {
  const { insert } = useReplyDraft()
  const [q, setQ] = useState('')
  const searching = q.trim().length >= 2

  const suggested = useQuery({
    queryKey: ['mention-resources', documentId],
    queryFn: async () => (await pulseFetch<{ data: Match[] }>('GET', `mentions/${documentId}/resources`)).data,
  })
  const found = useQuery({
    queryKey: ['resources-search', q.trim()],
    queryFn: async () =>
      (await pulseFetch<{ data: Match[] }>('GET', `resources?q=${encodeURIComponent(q.trim())}`)).data.slice(0, 8),
    enabled: searching,
  })

  const list = searching ? found : suggested
  const items = list.data ?? []

  return (
    <div
      data-testid="related-resources"
      className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          <BookOpen size={13} className="text-zinc-400" />
          Related resources
        </h4>
        <Link href="/resources" className="text-xs text-zinc-500 hover:underline">
          Manage
        </Link>
      </div>

      <div className="relative mb-2">
        <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search saved resources…"
          aria-label="Search saved resources"
          className="w-full rounded-md border border-zinc-300 bg-white py-1 pl-7 pr-2 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>

      {list.isLoading ? (
        <p className="flex items-center gap-1.5 py-1 text-xs text-zinc-500">
          <Spinner size={12} /> {searching ? 'Searching…' : 'Finding posts that fit…'}
        </p>
      ) : list.isError ? (
        <p className="text-xs text-red-600">{(list.error as Error).message}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-zinc-500">
          {searching ? (
            <>No saved resource matches “{q.trim()}”.</>
          ) : (
            <>
              No saved post fits this one.{' '}
              <Link href="/resources?view=find" className="text-blue-600 hover:underline">
                Find one on the blog
              </Link>
            </>
          )}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <li
              key={r.documentId}
              data-testid="related-resource"
              className="rounded border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-start gap-2">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 text-xs font-medium text-blue-600 hover:underline [overflow-wrap:anywhere]"
                >
                  {r.pinned && <Pin size={10} className="mr-1 inline text-[#4945FF]" aria-label="Pinned" />}
                  {r.title}
                </a>
                <button
                  onClick={() => insert(`${r.title} — ${r.url}`, 'resource')}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-700 hover:border-zinc-400 max-sm:min-h-[34px] max-sm:px-2.5 dark:border-zinc-700 dark:text-zinc-300"
                  title="Insert the title and link at the cursor in your reply (undoable)"
                >
                  <CornerDownLeft size={11} /> Insert
                </button>
              </div>
              {r.note ? (
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{r.note}</p>
              ) : (
                r.summary && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{r.summary}</p>
              )}
              {!searching && r.matched && r.matched.length > 0 && (
                <p className="mt-1 text-[11px] text-zinc-400">matches: {r.matched.join(', ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
