import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { IdCard } from 'lucide-react'
import ResponseCard from '@/components/response-card'
import { ConversationThread } from '@/components/conversation-thread'
import { BackToQueue } from '@/components/queue-view-memory'
import { strapiFetch, fetchAllTopics } from '@/lib/strapi'
import { SentimentBadge, StatusBadge, LaneBadge } from '@/components/badges'
import MentionActions from '@/components/mention-actions'
import { UserChip } from '@/components/ui'
import Timeline from '@/components/timeline'
import { ReplyDraftProvider } from '@/components/reply-draft-context'
import { ReplyChat } from '@/components/reply-chat'

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

  const topics = { data: await fetchAllTopics() }
  const config = await strapiFetch('/api/insights/config').catch(() => ({ data: { aiEnabled: false } }))
  const me = await strapiFetch('/api/users/me').catch(() => null)
  // Only asked for when the permalink yielded a conversation — X and LinkedIn
  // URLs carry nothing to thread on, so most mentions skip this entirely.
  const thread = m.threadKey
    ? await strapiFetch(`/api/mentions/${m.documentId}/thread`).catch(() => null)
    : null

  return (
    // The provider wraps BOTH columns: the reply text and the conversation about
    // it are edited from the left and the right, so they belong to neither.
    // 380px rather than 320 — the assistant has to be able to show a proposed
    // reply without it reading as a ransom note.
    <ReplyDraftProvider>
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        <BackToQueue />
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <SentimentBadge label={m.sentimentLabel} />
          <StatusBadge status={m.status} />
          <LaneBadge lane={m.lane} reason={m.laneReason} />
          {m.status === 'acknowledged' && m.acknowledgeReason && (
            <span className="text-xs rounded px-1.5 py-0.5 bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
              {m.acknowledgeReason}
            </span>
          )}
          {m.quality === 'suspected-spam' && (
            <span className="text-xs rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              suspected spam
            </span>
          )}
          {m.quality === 'spam' && (
            <span className="text-xs rounded px-1.5 py-0.5 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
              spam
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
          <UserChip user={m.owner} label="Claimed by" size="xs" />
          <UserChip user={m.assignee} label="Assigned to" size="xs" muted />
        </div>

        {/* Whether we know who this author actually is — asked here because
            this is where the question occurs to you. Reading someone say they
            are shopping for a CMS is the moment you decide they are worth
            researching, and until now that meant leaving for the Leads page and
            finding them again. Starting a profile still creates nothing until
            it is saved; this link just opens the form. */}
        {m.person?.documentId && (
          <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <IdCard size={12} className="text-zinc-400" />
            {m.person.leadProfile?.startedAt ? (
              <>
                <span className={m.person.leadProfile.email ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                  {m.person.leadProfile.email ? 'Profile · reachable' : 'Profile · no email yet'}
                </span>
                {m.person.leadProfile.company && (
                  <span className="text-zinc-500">{m.person.leadProfile.company}</span>
                )}
                <Link href={`/leads/${m.person.documentId}`} className="text-zinc-500 underline underline-offset-2">
                  open profile
                </Link>
              </>
            ) : (
              <>
                <span className="text-zinc-500">
                  No profile for @{m.authorHandle ?? 'this author'} — we know what they said, not
                  who they are.
                </span>
                <Link
                  href={`/leads/${m.person.documentId}?profile=1`}
                  className="underline underline-offset-2"
                >
                  Start a profile →
                </Link>
              </>
            )}
          </p>
        )}

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

        {/* above the actions: it is context for the reply you are about to
            write, and the "they replied after you" case is the reason to read
            it before writing anything */}
        <div className="mt-6">
          <ConversationThread mentions={thread?.data?.mentions ?? []} venue={m.venue} />
        </div>

        <MentionActions mention={m} allTopics={topics.data ?? []} aiEnabled={config.data.aiEnabled} />

        <section className="mt-8">
          <h2 className="font-medium mb-3">Responses</h2>
          {(m.responses ?? []).length === 0 && (
            <p className="text-sm text-zinc-500">No response recorded yet.</p>
          )}
          <ul data-testid="responses" className="space-y-3">
            {(m.responses ?? []).map((r: any) => (
                <ResponseCard
                  key={r.documentId}
                  response={r}
                  canEdit={Boolean(me?.documentId) && r.respondedBy?.documentId === me?.documentId}
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
                    {/* corrected wording must never pass as the original: the
                        outcome and sentiment were recorded against what was
                        actually said */}
                    {r.editedAt && <span title={new Date(r.editedAt).toLocaleString()}> · (edited)</span>}
                    {!r.internal && (
                      <>
                        {' '}· outcome: <span className="font-medium">{r.outcome?.result ?? 'not recorded'}</span>
                      </>
                    )}
                  </p>
                  {r.notes && <p className="text-xs text-zinc-400 mt-1">notes: {r.notes}</p>}
                </ResponseCard>
            ))}
          </ul>
        </section>
      </div>

      <aside className="space-y-6">
        {config.data.aiEnabled && (
          // Sticky: you scroll the mention and the responses while writing, and
          // an assistant that scrolls out of view is one you stop using.
          <div className="lg:sticky lg:top-20">
            <ReplyChat documentId={m.documentId} />
          </div>
        )}
        <Timeline mention={m} meDocumentId={me?.documentId ?? null} />
      </aside>
      </div>
    </ReplyDraftProvider>
  )
}
