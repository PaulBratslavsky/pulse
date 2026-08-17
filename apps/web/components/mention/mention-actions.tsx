'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'

import { ChevronRight, X, Sparkles } from 'lucide-react'
import { pulseFetch, PulseApiError } from '@/lib/pulse-client'
import { MutationError } from '@/components/ui/mutation-error'
import { Spinner } from '@/components/ui'
import { TopicPicker } from '@/components/mention/topic-picker'
import MuteAuthorButton from '@/components/mention/mute-author-button'
import SpamFlagButton from '@/components/mention/spam-flag-button'
import OwnPostButton from '@/components/mention/own-post-button'
import { ACK_REASONS, ackLabelWithHint } from '@/lib/acknowledge-reasons'

const post = (path: string, body?: unknown) => pulseFetch('POST', path, body)

export default function MentionActions({
  mention,
  allTopics,
  aiEnabled,
}: {
  mention: any
  allTopics: any[]
  aiEnabled: boolean
}) {
  const router = useRouter()
  // The reply text, its undo slot and the chat transcript live on the page, not
  // here: the assistant in the sidebar edits the same words this textarea does.
  const [showCorrect, setShowCorrect] = useState(false)
  const [corrLabel, setCorrLabel] = useState(mention.sentimentLabel ?? 'neutral')
  const [corrTopics, setCorrTopics] = useState<string[]>((mention.topics ?? []).map((t: any) => t.documentId))
  const [corrLane, setCorrLane] = useState<string>(mention.lane ?? 'respond')
  const [newTopics, setNewTopics] = useState<string[]>([])
  const [showAck, setShowAck] = useState(false)
  const [ackReason, setAckReason] = useState('competitor')
  const [ackNote, setAckNote] = useState('')

  // Escape dismisses an open panel (nothing is saved until the explicit button)
  useEffect(() => {
    if (!showAck && !showCorrect) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setShowAck(false)
      setShowCorrect(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAck, showCorrect])

  const claim = useMutation({
    mutationFn: () => post(`mentions/${mention.documentId}/claim`),
    onSuccess: () => router.refresh(),
  })
  const correct = useMutation({
    mutationFn: () =>
      post(`mentions/${mention.documentId}/correct`, {
        sentimentLabel: corrLabel,
        topicIds: corrTopics,
        newTopics: newTopics.length ? newTopics : undefined,
        lane: corrLane,
      }),
    onSuccess: () => {
      setShowCorrect(false)
      setNewTopics([])
      router.refresh()
    },
  })
  const acknowledge = useMutation({
    mutationFn: () =>
      post(`mentions/${mention.documentId}/acknowledge`, { reason: ackReason, note: ackNote || undefined }),
    onSuccess: () => {
      setShowAck(false)
      setAckNote('')
      router.refresh()
    },
  })
  const outcome = useMutation({
    mutationFn: ({ responseId, result }: { responseId: string; result: string }) =>
      pulseFetch('PUT', `responses/${responseId}/outcome`, { result }),
    onSuccess: () => router.refresh(),
    // 409 = stale page (already resolved / already recorded) — refresh to reality
    onError: (err) => {
      if (err instanceof PulseApiError && err.status === 409) router.refresh()
    },
  })

  // outcome tracking applies to public replies only — internal notes never "land"
  const lastResponse = (mention.responses ?? []).filter((r: any) => !r.internal).at(-1)

  return (
    <div className="mt-6 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {mention.status === 'unanswered' && (
          <button
            onClick={() => claim.mutate()}
            disabled={claim.isPending}
            className="inline-flex items-center gap-1.5 text-sm rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-1.5 font-medium disabled:opacity-50"
          >
            {claim.isPending && <Spinner size={12} />}
            {claim.isPending ? 'Claiming…' : 'Claim'}
          </button>
        )}
        <button
          onClick={() => setShowCorrect((v) => !v)}
          className="text-sm rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5"
        >
          {aiEnabled ? 'Correct analysis' : 'Set sentiment / topics'}
        </button>
        {['unanswered', 'claimed'].includes(mention.status) && (
          <button
            onClick={() => setShowAck((v) => !v)}
            className="text-sm rounded-md border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 px-3 py-1.5"
          >
            Acknowledge — no reply
          </button>
        )}
        <MutationError m={claim} className="text-xs" />
        <MutationError m={outcome} className="text-xs" />
      </div>

      {/* second row: moderation. Separated from the workflow actions above
          because five buttons wrapped raggedly across three lines, and these
          two are a different kind of decision — about the AUTHOR, not the reply */}
      <div className="flex gap-2 flex-wrap">
        {['unanswered', 'claimed'].includes(mention.status) && (
          <OwnPostButton documentId={mention.documentId} />
        )}
        {mention.quality !== 'spam' && (
          <SpamFlagButton
            documentId={mention.documentId}
            quality={mention.quality}
            qualityReason={mention.qualityReason}
            qualityVia={mention.qualityVia}
          />
        )}
        {mention.authorHandle && mention.quality !== 'spam' && (
          <MuteAuthorButton handle={mention.authorHandle} />
        )}
        {mention.quality === 'spam' && (
          <span
            className="inline-flex items-center rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300"
            title="This author is muted — their mentions stay out of the queue and all reports"
          >
            author muted
          </span>
        )}
        {lastResponse && !lastResponse.outcome?.result && (
          <div className="flex items-center gap-1 text-sm">
            <span className="text-zinc-500">Outcome:</span>
            {['resolved', 'positive-turn', 'no-reaction', 'escalated'].map((r) => (
              <button
                key={r}
                onClick={() => outcome.mutate({ responseId: lastResponse.documentId, result: r })}
                className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs"
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {showAck && (
        <div className="rounded-lg border border-violet-300 dark:border-violet-800 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium">Close without a public reply</p>
            <button
              onClick={() => setShowAck(false)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              aria-label="Close without acknowledging"
              title="Close this panel"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            The mention leaves the queue but keeps feeding trends, themes, and reports. Use internal
            notes below to record the team&apos;s take.
          </p>
          <div className="flex gap-3 flex-wrap">
            {ACK_REASONS.map((r) => (
              <label key={r.value} className="text-sm flex items-center gap-1">
                <input type="radio" checked={ackReason === r.value} onChange={() => setAckReason(r.value)} />{' '}
                {ackLabelWithHint(r)}
              </label>
            ))}
          </div>
          <input
            value={ackNote}
            onChange={(e) => setAckNote(e.target.value)}
            placeholder="Why (optional — goes to the activity trail)"
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          />
          <button
            onClick={() => acknowledge.mutate()}
            disabled={acknowledge.isPending}
            className="inline-flex items-center gap-1.5 text-sm rounded-md bg-violet-600 text-white px-3 py-1.5 disabled:opacity-50"
          >
            {acknowledge.isPending && <Spinner size={12} />}
            {acknowledge.isPending ? 'Acknowledging…' : 'Acknowledge'}
          </button>
          {acknowledge.isError && <p className="text-sm text-red-600">{String(acknowledge.error)}</p>}
        </div>
      )}

      {showCorrect && (
        <div className="rounded-lg border border-violet-300 dark:border-violet-800 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium">
              {aiEnabled
                ? 'Human correction (never overwritten by re-analysis)'
                : 'Manual labeling (AI analysis is disabled — labels are set by the team)'}
            </p>
            <button
              onClick={() => setShowCorrect(false)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              aria-label="Close without saving"
              title="Close this panel"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex gap-3 flex-wrap">
            {[
              { value: 'positive', label: 'positive' },
              { value: 'neutral', label: 'neutral' },
              { value: 'negative', label: 'negative' },
              { value: 'na', label: 'n/a — not about Strapi' },
            ].map((l) => (
              <label key={l.value} className="text-sm flex items-center gap-1">
                <input type="radio" checked={corrLabel === l.value} onChange={() => setCorrLabel(l.value)} />{' '}
                {l.label}
              </label>
            ))}
          </div>
          {/* Routing was correctable by an agent (pulse-set-lane) but by nobody
              in this app, so "this person is shopping for a CMS" could only be
              fixed from Claude Code. Saving a lane also claims the mention as
              human-corrected, so re-analysis leaves it alone. */}
          <div className="space-y-1">
            <p className="text-sm text-zinc-500">Routing lane</p>
            <div className="flex gap-3 flex-wrap">
              {[
                { value: 'respond', label: 'reply work' },
                { value: 'lead', label: 'lead — choosing, trying or moving' },
                { value: 'monitor', label: 'monitor — no reply needed' },
              ].map((l) => (
                <label key={l.value} className="text-sm flex items-center gap-1">
                  <input type="radio" checked={corrLane === l.value} onChange={() => setCorrLane(l.value)} />{' '}
                  {l.label}
                </label>
              ))}
            </div>
            {corrLane === 'lead' && mention.lane !== 'lead' && (
              <p className="text-xs text-zinc-500">
                Scores as a lead, but not a hot one — the 50-point signal is a quote from the author
                verified against their post, and only automatic classification can produce that.
              </p>
            )}
          </div>
          <TopicPicker
            all={allTopics}
            selectedIds={corrTopics}
            onSelectedIds={setCorrTopics}
            newNames={newTopics}
            onNewNames={setNewTopics}
          />
          <button
            onClick={() => correct.mutate()}
            disabled={correct.isPending}
            className="inline-flex items-center gap-1.5 text-sm rounded-md bg-violet-600 text-white px-3 py-1.5 disabled:opacity-50"
          >
            {correct.isPending && <Spinner size={12} />}
            {correct.isPending ? 'Saving…' : 'Save correction'}
          </button>
          <MutationError m={correct} />
        </div>
      )}

    </div>
  )
}
