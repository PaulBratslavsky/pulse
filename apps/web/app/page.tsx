import Link from 'next/link'
import { redirect } from 'next/navigation'
import { strapiFetch, qs } from '@/lib/strapi'
import { MessageSquare } from 'lucide-react'
import { SentimentBadge, StatusBadge, StalenessFlag, PostedDate } from '@/components/badges'
import ClaimButton from '@/components/claim-button'
import SyncButton from '@/components/sync-button'

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sentiment?: string; topic?: string; page?: string }>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  let data: any
  try {
    data = await strapiFetch(
      '/api/mentions' +
        qs({
          'filters[status][$in][0]': params.status ?? 'unanswered',
          ...(params.status ? {} : { 'filters[status][$in][1]': 'claimed' }),
          ...(params.sentiment ? { 'filters[sentimentLabel][$eq]': params.sentiment } : {}),
          ...(params.topic ? { 'filters[topics][slug][$eq]': params.topic } : {}),
          sort: 'postedAt:asc',
          'pagination[page]': page,
          'pagination[pageSize]': 25,
        })
    )
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }
  const mentions = data.data ?? []
  const pagination = data.meta?.pagination ?? { page: 1, pageCount: 1, total: mentions.length }
  const filterUrl = (over: { status?: string; sentiment?: string; topic?: string; page?: number }) => {
    const q = new URLSearchParams()
    const status = 'status' in over ? over.status : params.status
    if (status) q.set('status', status)
    const sentiment = over.sentiment !== undefined ? over.sentiment : params.sentiment
    const topic = over.topic !== undefined ? over.topic : params.topic
    if (sentiment) q.set('sentiment', sentiment)
    if (topic) q.set('topic', topic)
    if (over.page && over.page > 1) q.set('page', String(over.page))
    const qs = q.toString()
    return qs ? `/?${qs}` : '/'
  }
  const pageUrl = (p: number) => filterUrl({ page: p })

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Queue</h1>
          <p className="text-sm text-zinc-500">
            {params.status ? `${params.status} mentions, oldest first.` : 'Unanswered and claimed mentions, oldest first.'}
          </p>
        </div>
        <SyncButton />
      </div>

      <div className="flex gap-2 mb-2 text-sm items-center flex-wrap">
        {['', 'unanswered', 'claimed', 'answered', 'acknowledged', 'resolved'].map((s) => (
          <Link
            key={s || 'queue'}
            href={filterUrl({ status: s || undefined, page: 0 })}
            className={`rounded-full px-3 py-1 border ${
              (params.status ?? '') === s
                ? 'border-zinc-900 dark:border-white font-medium'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-500'
            }`}
          >
            {s || 'queue'}
          </Link>
        ))}
      </div>

      <div className="flex gap-2 mb-4 text-sm items-center flex-wrap">
        {params.topic && (
          <Link
            href={filterUrl({ topic: undefined, page: 0 })}
            className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#4945FF] to-[#7B79FF] text-white px-3 py-1 font-medium"
            title="Clear topic filter"
          >
            #{params.topic} ✕
          </Link>
        )}
        {['', 'negative', 'neutral', 'positive'].map((s) => (
          <Link
            key={s || 'all'}
            href={filterUrl({ sentiment: s || undefined, page: 0 })}
            className={`rounded-full px-3 py-1 border ${
              (params.sentiment ?? '') === s
                ? 'border-zinc-900 dark:border-white font-medium'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-500'
            }`}
          >
            {s || 'all'}
          </Link>
        ))}
      </div>

      {mentions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
          <p className="text-lg font-medium mb-1">Queue is clear 🎉</p>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Pulse collects data from launch onward — new mentions land here automatically as the
            webhook delivers them. If you just set up, point Octolens at{' '}
            <code className="text-xs">/api/octolens/ingest</code> and give it a minute.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {mentions.map((m: any) => (
            <li
              key={m.documentId}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
            >
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <SentimentBadge label={m.sentimentLabel} />
                <StatusBadge status={m.status} />
                <StalenessFlag postedAt={m.postedAt ?? m.receivedAt} />
                {m.draftText && (
                  <span className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                    draft ready
                  </span>
                )}
                {(m.comments ?? []).length > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-zinc-500"
                    title={`${m.comments.length} comment(s)/note(s)`}
                  >
                    <MessageSquare size={12} /> {m.comments.length}
                  </span>
                )}
                <span className="text-xs text-zinc-500">
                  @{m.authorHandle ?? 'unknown'} · {m.channel?.name ?? '—'} ·
                </span>
                <PostedDate postedAt={m.postedAt ?? m.receivedAt} />
                {(m.topics ?? []).map((t: any) => (
                  <Link key={t.slug} href={filterUrl({ topic: t.slug, page: 0 })} className="text-xs text-zinc-400 hover:text-[#4945FF]">
                    #{t.name}
                  </Link>
                ))}
              </div>
              <Link
                href={`/mentions/${m.documentId}`}
                className="block group"
                title="Open full mention"
              >
                <span className="line-clamp-3 break-words group-hover:text-zinc-950 dark:group-hover:text-white">
                  {m.content}
                </span>
                {m.content.length > 240 && (
                  <span className="text-xs text-blue-600 group-hover:underline">Read more →</span>
                )}
              </Link>
              <div className="mt-3 flex items-center gap-2">
                {m.status === 'unanswered' && <ClaimButton documentId={m.documentId} />}
                {m.owner && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-sm text-zinc-700 dark:text-zinc-300">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-[#4945FF] to-[#7B79FF] text-white text-[10px] font-semibold">
                      {m.owner.username.charAt(0).toUpperCase()}
                    </span>
                    Claimed by <strong>{m.owner.username}</strong>
                  </span>
                )}
                <Link
                  href={`/mentions/${m.documentId}`}
                  className="text-sm rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1"
                >
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pagination.pageCount > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-4 text-sm" aria-label="Pagination">
          {pagination.page > 1 ? (
            <Link href={pageUrl(pagination.page - 1)} className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              ← Prev
            </Link>
          ) : (
            <span className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-400">← Prev</span>
          )}
          <span className="text-zinc-500">
            Page {pagination.page} of {pagination.pageCount} · {pagination.total} mentions
          </span>
          {pagination.page < pagination.pageCount ? (
            <Link href={pageUrl(pagination.page + 1)} className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              Next →
            </Link>
          ) : (
            <span className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-400">Next →</span>
          )}
        </nav>
      )}
    </div>
  )
}
