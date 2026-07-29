import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageSquareHeart, ExternalLink } from 'lucide-react'
import { strapiFetch } from '@/lib/strapi'
import { SentimentBadge } from '@/components/badges'
import { FilterPill, EmptyState, Avatar } from '@/components/ui'

/**
 * Product feedback — the "what should we build" surface.
 * Reads human-captured `feedback` timeline entries rather than raw mention
 * text: the team's framing of a pain point is worth more than a keyword match,
 * and it means everything here was judged worth capturing by a person.
 */
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; days?: string }>
}) {
  const params = await searchParams
  const days = ['30', '90', '365'].includes(params.days ?? '') ? params.days! : '90'

  let data: any
  try {
    data = (
      await strapiFetch(
        `/api/insights/feedback?days=${days}${params.topic ? `&topic=${encodeURIComponent(params.topic)}` : ''}`
      )
    ).data
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }

  const url = (over: { topic?: string; days?: string }) => {
    const q = new URLSearchParams()
    const topic = 'topic' in over ? over.topic : params.topic
    const d = over.days ?? days
    if (topic) q.set('topic', topic)
    if (d !== '90') q.set('days', d)
    const s = q.toString()
    return s ? `/feedback?${s}` : '/feedback'
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Product feedback</h1>
          <p className="text-sm text-zinc-500">
            Pain points and insight the team captured from real mentions — {data.total} in the last{' '}
            {days} days.
          </p>
        </div>
        <div className="flex gap-2 text-sm" role="group" aria-label="Time window">
          {['30', '90', '365'].map((d) => (
            <FilterPill key={d} href={url({ days: d })} active={days === d}>
              {d === '365' ? '1y' : `${d}d`}
            </FilterPill>
          ))}
        </div>
      </div>

      {data.topics.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-xs text-zinc-500">
            Product areas the team tagged — what keeps coming up, and the closest thing to a
            prioritisation signal
          </p>
          <div className="flex flex-wrap gap-2">
            {params.topic && (
              <FilterPill href={url({ topic: undefined })} active activeClassName="border-[#4945FF] bg-[#4945FF]/10 font-medium text-[#4945FF]">
                #{params.topic} ✕
              </FilterPill>
            )}
            {data.topics.map((t: any) => (
              <FilterPill key={t.slug} href={url({ topic: t.slug })} active={params.topic === t.slug}>
                #{t.name} <span className="text-zinc-400">{t.count}</span>
              </FilterPill>
            ))}
          </div>
        </div>
      )}

      {data.items.length === 0 ? (
        <EmptyState icon={<MessageSquareHeart className="mx-auto mb-4 text-zinc-400" size={40} />} title="No feedback captured yet">
          <p className="text-sm text-zinc-500 max-w-lg mx-auto">
            When someone tells you what hurts — a missing feature, a confusing API, a migration
            snag — open the mention and add a <strong>Feedback</strong> entry in the timeline, tagging
            the area it touches (visual editor, admin panel…). It lands here, grouped by those tags,
            so the product team can see what keeps coming up.
          </p>
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {data.items.map((f: any) => (
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
                      href={url({ topic: t.slug })}
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
                    <Link key={t.slug} href={url({ topic: t.slug })} className="hover:text-[#4945FF]">
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
