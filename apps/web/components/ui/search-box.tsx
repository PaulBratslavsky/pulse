'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { SentimentBadge } from './badges'

export default function SearchBox() {
  const [q, setQ] = useState('')
  const enabled = q.trim().length >= 2
  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: async () => (await pulseFetch('GET', `search?q=${encodeURIComponent(q)}`)).data,
    enabled,
  })

  return (
    <div className="relative w-full max-w-md">
      {/* leading icon matches the Themes search — same affordance, same shape */}
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
        aria-hidden
      />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search mentions & past responses…"
        aria-label="Search mentions and past responses"
        className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {enabled && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg max-h-96 overflow-auto">
          {isFetching && <p className="p-3 text-sm text-zinc-500">Searching…</p>}
          {data && data.mentions.length === 0 && data.responses.length === 0 && (
            <p className="p-3 text-sm text-zinc-500">No matches.</p>
          )}
          {data?.mentions.map((m: any) => (
            <Link
              key={m.documentId}
              href={`/mentions/${m.documentId}`}
              className="block p-3 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm"
              onClick={() => setQ('')}
            >
              <SentimentBadge label={m.sentimentLabel} />{' '}
              <span className="text-zinc-700 dark:text-zinc-300">{m.content.slice(0, 90)}</span>
            </Link>
          ))}
          {data?.responses.map((r: any) => (
            <Link
              key={r.documentId}
              href={r.mention ? `/mentions/${r.mention.documentId}` : '#'}
              className="block p-3 border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm"
              onClick={() => setQ('')}
            >
              <span className="text-xs font-medium text-zinc-400 mr-1">reply</span>
              <span className="text-zinc-700 dark:text-zinc-300">{r.finalText.slice(0, 90)}</span>
              <span className="text-xs text-zinc-400 block">
                by {r.respondedBy?.username ?? '—'} · {r.outcome?.result ?? 'no outcome yet'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
