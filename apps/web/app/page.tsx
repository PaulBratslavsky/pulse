import Link from 'next/link'
import { redirect } from 'next/navigation'
import { strapiFetch, qs, fetchAllTopics } from '@/lib/strapi'
import { MessageSquare, MessagesSquare } from 'lucide-react'
import { SentimentBadge, StatusBadge, StalenessFlag, PostedDate, LaneBadge } from '@/components/badges'
import { UserChip, FilterPill, EmptyState, FilterRow } from '@/components/ui'
import { RememberQueueView } from '@/components/queue-view-memory'
import { commentCount } from '@/lib/types'
import ClaimButton from '@/components/claim-button'
import MuteAuthorButton from '@/components/mute-author-button'
import SpamFlagButton from '@/components/spam-flag-button'
import OwnPostButton from '@/components/own-post-button'
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
    lane?: string
    awaiting?: string
    every?: string
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
          // Someone answered us and nobody answered them. Derived on write
          // (utils/thread-state) rather than computed here, because "the last
          // message in this thread that is not ours" is not expressible as a
          // filter over a single row.
          ...(params.awaiting ? { 'filters[awaitsReply][$eq]': 'true' } : {}),
          // spam is stored but never queued; suspected-spam stays visible with a badge
          ...(params.quality
            ? { 'filters[quality][$eq]': params.quality }
            : { 'filters[quality][$ne]': 'spam' }),
          // Lanes: the queue is REPLY work. Competitor/industry discourse is
          // kept in full and still feeds trends and themes — it just doesn't
          // belong in a list a human works through. ~2/3 of ingest is that.
          ...(params.lane === 'all'
            ? {}
            : params.lane
              ? { 'filters[lane][$eq]': params.lane }
              : {
                  'filters[lane][$in][0]': 'respond',
                  'filters[lane][$in][1]': 'lead',
                }),
          sort: params.sort === 'newest' ? 'postedAt:desc' : 'postedAt:asc',
          // One row per conversation by default. Octolens ingests every comment
          // in a thread as its own mention, so a single Reddit exchange arrives
          // as N rows that look like N separate jobs — and the one actually
          // waiting on us is indistinguishable from the ones already handled.
          ...(params.every ? {} : { group: 'thread' }),
          'pagination[page]': page,
          'pagination[pageSize]': 25,
        })
    )
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }
  const topicsRes = { data: await fetchAllTopics().catch(() => []) }
  const mentions = data.data ?? []
  // The server says whether it actually grouped: it falls back to a flat list
  // when the filtered set is too large to group honestly, and the label must
  // not claim otherwise.
  const grouped = data.meta?.grouped === true
  const pagination = data.meta?.pagination ?? { page: 1, pageCount: 1, total: mentions.length }
  const filterUrl = (over: {
    status?: string
    sentiment?: string
    topic?: string
    page?: number
    draft?: string
    awaiting?: string
    quality?: string
    topics?: string
    sort?: string
    q?: string
    lane?: string
    every?: string
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
    const lane = 'lane' in over ? over.lane : params.lane
    const noTopics = 'topics' in over ? over.topics : params.topics
    const sort = 'sort' in over ? over.sort : params.sort
    const qText = 'q' in over ? over.q : params.q
    const every = 'every' in over ? over.every : params.every
    if (sentiment) q.set('sentiment', sentiment)
    if (topic) q.set('topic', topic)
    if (draft) q.set('draft', draft)
    if (quality) q.set('quality', quality)
    if (noTopics) q.set('topics', noTopics)
    if (sort) q.set('sort', sort)
    if (qText) q.set('q', qText)
    if (lane) q.set('lane', lane)
    if (every) q.set('every', every)
    if (over.page && over.page > 1) q.set('page', String(over.page))
    const qs = q.toString()
    return qs ? `/?${qs}` : '/'
  }
  const pageUrl = (p: number) => filterUrl({ page: p })

  // the query as the browser has it, so returning here restores this exact view
  const currentSearch = qs({
    ...(params.status ? { status: params.status } : {}),
    ...(params.sentiment ? { sentiment: params.sentiment } : {}),
    ...(params.topic ? { topic: params.topic } : {}),
    ...(params.topics ? { topics: params.topics } : {}),
    ...(params.draft ? { draft: params.draft } : {}),
    ...(params.awaiting ? { awaiting: params.awaiting } : {}),
    ...(params.quality ? { quality: params.quality } : {}),
    ...(params.lane ? { lane: params.lane } : {}),
    ...(params.sort ? { sort: params.sort } : {}),
    ...(params.q ? { q: params.q } : {}),
    ...(params.every ? { every: params.every } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  })

  return (
    <div>
      <RememberQueueView search={currentSearch} />
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          {/* count is the whole filtered set, not this page — "how much is
              left" is the number you want at a glance, and it rides along in
              the pagination meta for free */}
          <h1 className="flex items-baseline gap-2.5 text-2xl font-semibold">
            Queue
            <span
              data-testid="queue-count"
              className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-sm font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              title={
                grouped
                  ? `${pagination.total} conversations — a thread of six messages is one row here`
                  : params.status
                    ? `${pagination.total} ${params.status} mentions`
                    : `${pagination.total} mentions still open (unanswered or claimed)`
              }
            >
              {pagination.total}
            </span>
          </h1>
          <p className="text-sm text-zinc-500">
            {grouped ? 'Conversations' : params.status ? `${params.status} mentions` : 'Unanswered and claimed mentions'}
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

      {/* One row per axis. Everything used to share two wrapping rows, so a
          group could split across lines — "monitor" and "all lanes" ended up
          orphaned from "reply work" — and the labels couldn't rescue it. A
          fixed label column makes the rows scan vertically. */}
      <div className="mb-4 space-y-1.5 text-sm">
        {/* active topic sits above the axes — it comes from elsewhere (a theme
            or a chip) and clearing it is a distinct action */}
        {params.topic && (
          <FilterRow label="topic">
            <Link
              href={filterUrl({ topic: undefined, page: 0 })}
              className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#4945FF] to-[#7B79FF] px-3 py-1 font-medium text-white"
              title="Clear topic filter"
            >
              #{params.topic} ✕
            </Link>
          </FilterRow>
        )}
        <FilterRow label="status">
          {['', 'unanswered', 'claimed', 'answered', 'acknowledged', 'resolved'].map((v) => (
            <FilterPill key={v || 'queue'} href={filterUrl({ status: v || undefined, page: 0 })} active={(params.status ?? '') === v}>
              {v || 'queue'}
            </FilterPill>
          ))}
        </FilterRow>

        <FilterRow label="lane">
          <FilterPill
            href={filterUrl({ lane: 'all', page: 0 })}
            active={params.lane === 'all'}
            title="Every lane at once — the whole corpus, routed or not"
          >
            all lanes
          </FilterPill>
          <FilterPill
            href={filterUrl({ lane: undefined, page: 0 })}
            active={!params.lane}
            title="Reply work: mentions naming Strapi, plus people shopping or leaving a competitor"
          >
            reply work
          </FilterPill>
          <FilterPill
            href={filterUrl({ lane: 'lead', page: 0 })}
            active={params.lane === 'lead'}
            activeClassName="border-emerald-500 bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
            title="Someone actively switching or evaluating — usually names no Strapi keyword at all"
          >
            leads
          </FilterPill>
          <FilterPill
            href={filterUrl({ lane: 'monitor', page: 0 })}
            active={params.lane === 'monitor'}
            title="Competitor and industry discourse — kept for trends and themes, not reply work"
          >
            monitor
          </FilterPill>
        </FilterRow>

        {/* Grouping is a view, not a filter — it changes what a ROW is, not
            which mentions qualify. Kept visible rather than tucked away,
            because a queue that quietly shows fewer rows than there are
            mentions has to say so. */}
        <FilterRow label="show">
          <FilterPill
            href={filterUrl({ every: undefined, page: 0 })}
            active={!params.every}
            title="One row per conversation: a thread of six messages is one job, not six"
          >
            conversations
          </FilterPill>
          <FilterPill
            href={filterUrl({ every: '1', page: 0 })}
            active={Boolean(params.every)}
            title="One row per message, including every reply in a thread"
          >
            every message
          </FilterPill>
        </FilterRow>

        <FilterRow label="sentiment">
          {['', 'negative', 'neutral', 'positive', 'na'].map((v) => (
            <FilterPill key={v || 'all'} href={filterUrl({ sentiment: v || undefined, page: 0 })} active={(params.sentiment ?? '') === v}>
              {v === 'na' ? 'n/a' : v || 'all'}
            </FilterPill>
          ))}
        </FilterRow>

        <FilterRow label="flags">
          {/* First, and coloured like an alert: this is the only flag that means
              a named person is waiting on an answer they asked us for. The rest
              describe the mention; this one describes a debt. */}
          <FilterPill
            href={filterUrl({ awaiting: params.awaiting ? undefined : '1', page: 0 })}
            active={Boolean(params.awaiting)}
            activeClassName="border-red-500 bg-red-50 font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300"
            title="Someone replied after our last answer in the same thread, and nobody has responded to them"
          >
            awaiting reply
          </FilterPill>
          <FilterPill
            href={filterUrl({ draft: params.draft ? undefined : '1', page: 0 })}
            active={Boolean(params.draft)}
            activeClassName="border-sky-500 bg-sky-50 font-medium text-sky-800 dark:bg-sky-900/30 dark:text-sky-300"
            title="Only mentions with a saved draft reply — the review backlog"
          >
            has draft
          </FilterPill>
          <FilterPill
            href={filterUrl({ q: params.q ? undefined : 'strapi', page: 0 })}
            active={Boolean(params.q)}
            activeClassName="border-[#4945FF] bg-[#4945FF]/10 font-medium text-[#4945FF]"
            title="Only mentions whose text actually says Strapi"
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
        </FilterRow>
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
                <LaneBadge lane={m.lane} reason={m.laneReason} />
                <StalenessFlag
                  postedAt={m.postedAt ?? m.receivedAt}
                  awaitingReply={['unanswered', 'claimed'].includes(m.status)}
                />
                {m.threadSize > 1 && (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
                    title={`This row stands for a conversation of ${m.threadSize} messages. Opening it shows the whole thread.`}
                  >
                    <MessagesSquare size={11} />
                    {m.threadSize} in thread
                  </span>
                )}
                {/* The reason grouping exists: someone answered us and nobody
                    answered them. Without this, the message waiting on a reply
                    looks exactly like the five above it that are done. */}
                {m.awaitsReply && (
                  <span
                    className="inline-block rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
                    title="They replied after our last answer and nobody has responded"
                  >
                    waiting on us
                  </span>
                )}
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
                {/* our own account replying to someone — recognisable from the
                    handle right here, so it shouldn't cost a trip to the detail
                    page and three clicks through the acknowledge panel */}
                {['unanswered', 'claimed'].includes(m.status) && (
                  <OwnPostButton documentId={m.documentId} compact />
                )}
                {m.quality !== 'spam' && (
                  <SpamFlagButton documentId={m.documentId} quality={m.quality} compact />
                )}
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
