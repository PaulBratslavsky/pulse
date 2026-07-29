import Link from 'next/link'
import { redirect } from 'next/navigation'
import { strapiFetch, qs } from '@/lib/strapi'
import { MessageSquare } from 'lucide-react'
import { SentimentBadge, StatusBadge, StalenessFlag, PostedDate } from '@/components/badges'
import { UserChip, FilterPill, EmptyState } from '@/components/ui'
import { commentCount } from '@/lib/types'
import ClaimButton from '@/components/claim-button'
import MuteAuthorButton from '@/components/mute-author-button'
import { SelectionProvider, SelectCheckbox, SelectionHint, QueueCard } from '@/components/bulk-triage'
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
    topics?: string
    sort?: string
    q?: string
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
          // unlabeled backlog — the set a bulk topic pass exists for
          ...(params.topics === 'none' ? { 'filters[topics][documentId][$null]': 'true' } : {}),
          // "is this actually about us?" — most of the queue arrives via
          // competitor keyword monitoring and never names Strapi
          ...(params.q ? { 'filters[content][$containsi]': params.q } : {}),
          ...(params.draft ? { 'filters[draftText][$notNull]': 'true' } : {}),
          // spam is stored but never queued; suspected-spam stays visible with a badge
          ...(params.quality
            ? { 'filters[quality][$eq]': params.quality }
            : { 'filters[quality][$ne]': 'spam' }),
          sort: params.sort === 'newest' ? 'postedAt:desc' : 'postedAt:asc',
          'pagination[page]': page,
          'pagination[pageSize]': 25,
        })
    )
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }
  const topicsRes = await strapiFetch('/api/topics?pagination[pageSize]=100&sort=name:asc').catch(() => ({
    data: [],
  }))
  const mentions = data.data ?? []
  const pagination = data.meta?.pagination ?? { page: 1, pageCount: 1, total: mentions.length }
  const filterUrl = (over: {
    status?: string
    sentiment?: string
    topic?: string
    page?: number
    draft?: string
    quality?: string
    topics?: string
    sort?: string
    q?: string
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
    const noTopics = 'topics' in over ? over.topics : params.topics
    const sort = 'sort' in over ? over.sort : params.sort
    const qText = 'q' in over ? over.q : params.q
    if (sentiment) q.set('sentiment', sentiment)
    if (topic) q.set('topic', topic)
    if (draft) q.set('draft', draft)
    if (quality) q.set('quality', quality)
    if (noTopics) q.set('topics', noTopics)
    if (sort) q.set('sort', sort)
    if (qText) q.set('q', qText)
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
            {params.status ? `${params.status} mentions` : 'Unanswered and claimed mentions'}
            {params.sort === 'newest' ? ', newest first.' : ', oldest first.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 text-sm" role="group" aria-label="Sort order">
            <FilterPill href={filterUrl({ sort: undefined, page: 0 })} active={params.sort !== 'newest'} title="Oldest first — SLA order: what has waited longest">
              oldest
            </FilterPill>
            <FilterPill href={filterUrl({ sort: 'newest', page: 0 })} active={params.sort === 'newest'} title="Newest first — catching up on what just arrived">
              newest
            </FilterPill>
          </div>
          <SyncButton />
        </div>
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
          href={filterUrl({ q: params.q ? undefined : 'strapi', page: 0 })}
          active={Boolean(params.q)}
          activeClassName="border-[#4945FF] bg-[#4945FF]/10 font-medium text-[#4945FF]"
          title="Only mentions whose text actually says Strapi — most of the queue arrives via competitor keyword monitoring"
        >
          mentions Strapi
        </FilterPill>
        <FilterPill
          href={filterUrl({ topics: params.topics === 'none' ? undefined : 'none', page: 0 })}
          active={params.topics === 'none'}
          title="Mentions with no topics yet — the set worth a bulk topic pass"
        >
          no topics
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
        <SelectionProvider
          allIds={mentions.map((m: any) => m.documentId)}
          topics={(topicsRes.data ?? []).map((t: any) => ({ documentId: t.documentId, name: t.name }))}
        >
        <div className="mb-2">
          <SelectionHint count={mentions.length} />
        </div>
        <ul className="space-y-3">
          {mentions.map((m: any) => (
            <QueueCard key={m.documentId} documentId={m.documentId}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <SelectCheckbox documentId={m.documentId} />
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
            </QueueCard>
          ))}
        </ul>
        </SelectionProvider>
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
