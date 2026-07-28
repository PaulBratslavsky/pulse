import { redirect, notFound } from 'next/navigation'
import { strapiFetch } from '@/lib/strapi'
import { SentimentBadge, StatusBadge } from '@/components/badges'
import MentionActions from '@/components/mention-actions'
import Timeline from '@/components/timeline'

export default async function MentionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let data: any
  try {
    data = await strapiFetch(`/api/mentions/${id}`)
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }
  const m = data.data
  if (!m) notFound()

  const topics = await strapiFetch('/api/topics?pagination[pageSize]=100&sort=name:asc')
  const config = await strapiFetch('/api/insights/config').catch(() => ({ data: { aiEnabled: false } }))

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <SentimentBadge label={m.sentimentLabel} />
          <StatusBadge status={m.status} />
          {m.status === 'acknowledged' && m.acknowledgeReason && (
            <span className="text-xs rounded px-1.5 py-0.5 bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
              {m.acknowledgeReason}
            </span>
          )}
          {m.humanCorrected && (
            <span className="text-xs rounded px-1.5 py-0.5 bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
              human-corrected
            </span>
          )}
          <span className="text-xs text-zinc-500">
            @{m.authorHandle ?? 'unknown'} · {m.channel?.name ?? '—'} ·{' '}
            {m.postedAt ? new Date(m.postedAt).toLocaleString() : '—'}
          </span>
          {m.owner && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-r from-rose-500 to-orange-400 text-white text-[9px] font-semibold">
                {m.owner.username.charAt(0).toUpperCase()}
              </span>
              Claimed by <strong>{m.owner.username}</strong>
            </span>
          )}
          {m.assignee && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-400 text-white text-[9px] font-semibold">
                {m.assignee.username.charAt(0).toUpperCase()}
              </span>
              Assigned to <strong>{m.assignee.username}</strong>
            </span>
          )}
        </div>

        <blockquote className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 mb-2 whitespace-pre-wrap break-words leading-relaxed max-h-[32rem] overflow-y-auto">
          {m.content}
        </blockquote>
        {m.url && (
          <a href={m.url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">
            View on {m.channel?.name ?? 'platform'} ↗
          </a>
        )}

        <div className="mt-2 flex gap-2 flex-wrap">
          {(m.topics ?? []).map((t: any) => (
            <span key={t.slug} className="text-xs rounded-full border border-zinc-300 dark:border-zinc-700 px-2 py-0.5">
              #{t.name}
            </span>
          ))}
          {m.modelVersion && (
            <span className="text-xs text-zinc-400">analyzed by {m.modelVersion} / {m.promptVersion}</span>
          )}
        </div>

        <MentionActions mention={m} allTopics={topics.data ?? []} aiEnabled={config.data.aiEnabled} />

        <section className="mt-8">
          <h2 className="font-medium mb-3">Responses</h2>
          {(m.responses ?? []).length === 0 && (
            <p className="text-sm text-zinc-500">No response recorded yet.</p>
          )}
          <ul className="space-y-3">
            {(m.responses ?? []).map((r: any) => (
              <li
                key={r.documentId}
                className={`rounded-lg border bg-white dark:bg-zinc-900 p-4 ${
                  r.internal
                    ? 'border-violet-300 dark:border-violet-800'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                {r.internal && (
                  <span className="inline-block mb-2 text-xs rounded px-1.5 py-0.5 bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 font-medium">
                    internal note
                  </span>
                )}
                <p className="text-sm whitespace-pre-wrap">{r.finalText}</p>
                <p className="text-xs text-zinc-500 mt-2">
                  by {r.respondedBy?.username ?? '—'} ·{' '}
                  {r.respondedAt ? new Date(r.respondedAt).toLocaleString() : '—'}
                  {!r.internal && (
                    <>
                      {' '}· outcome: <span className="font-medium">{r.outcome?.result ?? 'not recorded'}</span>
                    </>
                  )}
                </p>
                {r.notes && <p className="text-xs text-zinc-400 mt-1">notes: {r.notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside>
        <Timeline mention={m} />
      </aside>
    </div>
  )
}
