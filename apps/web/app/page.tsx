import Link from 'next/link'
import { redirect } from 'next/navigation'
import { strapiFetch, qs } from '@/lib/strapi'
import { SentimentBadge, StatusBadge, StalenessFlag } from '@/components/badges'
import SearchBox from '@/components/search-box'
import ClaimButton from '@/components/claim-button'

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sentiment?: string }>
}) {
  const params = await searchParams
  let data: any
  try {
    data = await strapiFetch(
      '/api/mentions' +
        qs({
          'filters[status][$in][0]': params.status ?? 'unanswered',
          ...(params.status ? {} : { 'filters[status][$in][1]': 'claimed' }),
          ...(params.sentiment ? { 'filters[sentimentLabel][$eq]': params.sentiment } : {}),
          sort: 'receivedAt:asc',
          'pagination[pageSize]': 50,
        })
    )
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }
  const mentions = data.data ?? []

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Queue</h1>
          <p className="text-sm text-zinc-500">Unanswered and claimed mentions, oldest first.</p>
        </div>
        <SearchBox />
      </div>

      <div className="flex gap-2 mb-4 text-sm">
        {['', 'negative', 'neutral', 'positive'].map((s) => (
          <Link
            key={s || 'all'}
            href={s ? `/?sentiment=${s}` : '/'}
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
                <StalenessFlag receivedAt={m.receivedAt} />
                <span className="text-xs text-zinc-500">
                  @{m.authorHandle ?? 'unknown'} · {m.channel?.name ?? '—'}
                  {m.owner ? ` · claimed by ${m.owner.username}` : ''}
                </span>
                {(m.topics ?? []).map((t: any) => (
                  <span key={t.slug} className="text-xs text-zinc-400">#{t.name}</span>
                ))}
              </div>
              <Link href={`/mentions/${m.documentId}`} className="block hover:underline">
                {m.content}
              </Link>
              <div className="mt-3 flex gap-2">
                {m.status === 'unanswered' && <ClaimButton documentId={m.documentId} />}
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
    </div>
  )
}
