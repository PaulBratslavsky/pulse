import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageSquareHeart } from 'lucide-react'
import { isAuthError, loaders } from '@/lib/loaders'
import { FilterPill, EmptyState } from '@/components/ui'
import FeedbackList from '@/components/insights/feedback-list'

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

  const res = await loaders.getFeedback(Number(days), params.topic)
  if (isAuthError(res)) redirect('/sign-in')
  // a 200 with no payload is a broken response, not an empty report
  if (!res.success || !res.data) throw new Error(res.error?.message ?? 'failed to load feedback')
  const data = res.data

  // ranked by count already — the head is the signal, the tail is reference
  const TOP_AREAS = 8
  const topTopics = (data.topics ?? []).slice(0, TOP_AREAS)
  const restTopics = (data.topics ?? []).slice(TOP_AREAS)

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
          {/* Top areas stay visible: they are ranked by count, so seeing them
              at a glance IS the prioritisation signal a dropdown would hide.
              The long tail folds into a disclosure so the list can't grow
              without bound. <details> keeps it working without JS. */}
          <div className="flex flex-wrap gap-2">
            {params.topic && (
              <FilterPill href={url({ topic: undefined })} active activeClassName="border-[#4945FF] bg-[#4945FF]/10 font-medium text-[#4945FF]">
                #{params.topic} ✕
              </FilterPill>
            )}
            {topTopics.map((t: any) => (
              <FilterPill key={t.slug} href={url({ topic: t.slug })} active={params.topic === t.slug}>
                #{t.name} <span className="text-zinc-400">{t.count}</span>
              </FilterPill>
            ))}
          </div>
          {restTopics.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                +{restTopics.length} more area{restTopics.length === 1 ? '' : 's'}
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {restTopics.map((t: any) => (
                  <FilterPill key={t.slug} href={url({ topic: t.slug })} active={params.topic === t.slug}>
                    #{t.name} <span className="text-zinc-400">{t.count}</span>
                  </FilterPill>
                ))}
              </div>
            </details>
          )}
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
        <FeedbackList items={data.items} days={days} activeTopic={params.topic} />
      )}
    </div>
  )
}
