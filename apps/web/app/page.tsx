import Link from 'next/link'
import { redirect } from 'next/navigation'
import { strapiFetch, qs } from '@/lib/strapi'
import { MessageSquare } from 'lucide-react'
import { SentimentBadge, StatusBadge, StalenessFlag, PostedDate } from '@/components/badges'
import { UserChip, FilterPill, EmptyState } from '@/components/ui'
import { commentCount } from '@/lib/types'
import ClaimButton from '@/components/claim-button'
import MuteAuthorButton from '@/components/mute-author-button'
import SyncButton from '@/components/sync-button'

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    sentiment?: string
    topic?: string
    page?: string
    draft?: string
    quality?: string
  }>
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
          ...(params.draft ? { 'filters[draftText][$notNull]': 'true' } : {}),
          // spam is stored but never queued; suspected-spam stays visible with a badge
          ...(params.quality
            ? { 'filters[quality][$eq]': params.quality }
            : { 'filters[quality][$ne]': 'spam' }),
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
  const filterUrl = (over: {
    status?: string
    sentiment?: string
    topic?: string
    page?: number
    draft?: string
    quality?: string
  }) => {
    const q = new URLSearchParams()
    // 'key' in over — NOT !== undefined — so passing an explicit undefined
    // actually CLEARS the filter (the "all" chip and topic ✕ depend on it)
    const status = 'status' in over ? over.status : params.status
    if (status) q.set('status', status)
    const sentiment = 'sentiment' in over ? over.sentiment : params.sentiment
    const topic = 'topic' in over ? over.topic : params.topic
    const draft = 'draft' in over ? over.draft : params.draft
    const quality = 'quality' in over ? over.quality : params.quality
    if (sentiment) q.set('sentiment', sentiment)
    if (topic) q.set('topic', topic)
    if (draft) q.set('draft', draft)
    if (quality) q.set('quality', quality)
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
          <FilterPill key={s || 'queue'} href={filterUrl({ status: s || undefined, page: 0 })} active={(params.status ?? '') === s}>
            {s || 'queue'}
          </FilterPill>
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
        {['', 'negative', 'neutral', 'positive', 'na'].map((s) => (
          <FilterPill key={s || 'all'} href={filterUrl({ sentiment: s || undefined, page: 0 })} active={(params.sentiment ?? '') === s}>
            {s === 'na' ? 'n/a' : s || 'all'}
          </FilterPill>
        ))}
        <FilterPill
          href={filterUrl({ draft: params.draft ? undefined : '1', page: 0 })}
          active={Boolean(params.draft)}
          activeClassName="border-sky-500 bg-sky-50 font-medium text-sky-800 dark:bg-sky-900/30 dark:text-sky-300"
          title="Only mentions with a saved draft reply"
        >
          has draft
        </FilterPill>
        <FilterPill
          href={filterUrl({ quality: params.quality === 'suspected-spam' ? undefined : 'suspected-spam', page: 0 })}
          active={params.quality === 'suspected-spam'}
          activeClassName="border-amber-500 bg-amber-50 font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          title="Heuristic spam hits awaiting review"
        >
          suspected spam
        </FilterPill>
        <FilterPill
          href={filterUrl({ quality: params.quality === 'spam' ? undefined : 'spam', page: 0 })}
          active={params.quality === 'spam'}
          activeClassName="border-red-500 bg-red-50 font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300"
          title="Muted authors / confirmed spam — hidden from the queue and all reports"
        >
          spam
        </FilterPill>
      </div>

      {mentions.length === 0 ? (
        <EmptyState title="Queue is clear 🎉">
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Pulse collects data from launch onward — new mentions land here automatically as the
            webhook delivers them. If you just set up, point Octolens at{' '}
            <code className="text-xs">/api/octolens/ingest</code> and give it a minute.
          </p>
        </EmptyState>
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
                <StalenessFlag
                  postedAt={m.postedAt ?? m.receivedAt}
                  awaitingReply={['unanswered', 'claimed'].includes(m.status)}
                />
                {m.quality === 'suspected-spam' && (
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    title="Matched a spam heuristic — review and mute the author, or clear it"
                  >
                    suspected spam
                  </span>
                )}
                {m.quality === 'spam' && (
                  <span className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                    spam
                  </span>
                )}
                {m.draftText && (
                  <span className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                    draft ready
                  </span>
                )}
                {commentCount(m) > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-zinc-500"
                    title={`${commentCount(m)} comment(s)/note(s)`}
                  >
                    <MessageSquare size={12} /> {commentCount(m)}
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
                <UserChip user={m.owner} label="Claimed by" />
                <Link
                  href={`/mentions/${m.documentId}`}
                  className="text-sm rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1"
                >
                  Open
                </Link>
                {m.authorHandle && m.quality !== 'spam' && (
                  <MuteAuthorButton handle={m.authorHandle} compact />
                )}
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
