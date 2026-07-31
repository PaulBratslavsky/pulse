'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Search } from 'lucide-react'
import { SentimentBadge } from '@/components/badges'
import { Avatar } from '@/components/ui'

/**
 * Feedback list with instant search. The window's entries are already loaded,
 * so filtering happens in memory — matching the Themes page, and avoiding a
 * server round-trip per keystroke.
 *
 * Search covers the captured text, the tags, and the source mention, because
 * "what did someone say about migrations" is as likely to be phrased in the
 * original post as in the note the team wrote about it.
 */
export default function FeedbackList({
  items,
  days,
  activeTopic,
}: {
  items: any[]
  days: string
  activeTopic?: string
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const topicUrl = (over: { topic?: string }) => {
    const sp = new URLSearchParams()
    const topic = 'topic' in over ? over.topic : activeTopic
    if (topic) sp.set('topic', topic)
    if (days !== '90') sp.set('days', days)
    const s = sp.toString()
    return s ? `/feedback?${s}` : '/feedback'
  }

  const filtered = useMemo(
    () =>
      !q
        ? items
        : items.filter((f) =>
            [
              f.body,
              f.capturedBy ?? '',
              f.mention?.excerpt ?? '',
              f.mention?.authorHandle ?? '',
              ...(f.tags ?? []).map((t: any) => t.name),
            ]
              .join(' ')
              .toLowerCase()
              .includes(q)
          ),
    [items, q]
  )

  return (
    <div>
      <div className="relative mb-4">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search feedback, tags, or the original mention…"
          aria-label="Search feedback"
          className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      {q && (
        <p className="mb-3 text-xs text-zinc-500" data-testid="feedback-count">
          {filtered.length} of {items.length} matching “{query.trim()}”
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="mb-1 text-lg font-medium">Nothing matches</p>
          <p className="text-sm text-zinc-500">Try a different search.</p>
        </div>
      ) : (
    <ul className="space-y-4">
      {filtered.map((f: any) => (
        <li
          key={f.documentId}
          className="rounded-lg border border-teal-300 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-900/20"
        >
          <p className="whitespace-pre-wrap break-words text-sm">{f.body}</p>

          {f.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {f.tags.map((t: any) => (
                <Link
                  key={t.slug}
                  href={topicUrl({ topic: t.slug })}
                  className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-900 hover:bg-teal-200 dark:bg-teal-900/40 dark:text-teal-200"
                >
                  #{t.name}
                </Link>
              ))}
            </div>
          )}

          {f.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {f.links.map((l: string) => (
                <a
                  key={l}
                  href={l}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs text-blue-600 hover:underline dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <ExternalLink size={11} /> {new URL(l).hostname.replace(/^www\./, '')}
                </a>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
            <Avatar name={f.capturedBy} size="xs" />
            captured by <strong>{f.capturedBy ?? '—'}</strong> ·{' '}
            {new Date(f.capturedAt).toLocaleDateString()}
          </div>

          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <SentimentBadge label={f.mention.sentimentLabel} />
              <span>
                @{f.mention.authorHandle ?? 'unknown'} · {f.mention.channel ?? '—'}
              </span>
              {f.mention.topics.map((t: any) => (
                <Link key={t.slug} href={topicUrl({ topic: t.slug })} className="hover:text-[#4945FF]">
                  #{t.name}
                </Link>
              ))}
            </div>
            <p className="line-clamp-3 text-sm text-zinc-700 dark:text-zinc-300">
              {f.mention.excerpt}
            </p>
            <div className="mt-2 flex gap-3 text-xs">
              <Link href={`/mentions/${f.mention.documentId}`} className="text-blue-600 hover:underline">
                Open in Pulse
              </Link>
              {f.mention.url && (
                <a href={f.mention.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                  View original ↗
                </a>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
      )}
    </div>
  )
}
