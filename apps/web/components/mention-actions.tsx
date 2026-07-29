'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'

import { ChevronRight } from 'lucide-react'
import { pulseFetch, PulseApiError } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'
import MuteAuthorButton from '@/components/mute-author-button'

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
  // a draft saved via MCP/chat (pulse-save-draft) is a SUGGESTION shown in a
  // collapsed accordion — the reply box starts empty so "what I actually sent"
  // is never confused with "what was suggested"
  const [draft, setDraft] = useState<string>(mention.draftText ?? '')
  const [finalText, setFinalText] = useState('')
  const [notes, setNotes] = useState('')
  const [showCorrect, setShowCorrect] = useState(false)
  const [corrLabel, setCorrLabel] = useState(mention.sentimentLabel ?? 'neutral')
  const [corrTopics, setCorrTopics] = useState<string[]>((mention.topics ?? []).map((t: any) => t.documentId))
  const [newTopics, setNewTopics] = useState<string[]>([])
  const [topicDraft, setTopicDraft] = useState('')
  const [showAck, setShowAck] = useState(false)
  const [ackReason, setAckReason] = useState('competitor')
  const [ackNote, setAckNote] = useState('')

  const claim = useMutation({
    mutationFn: () => post(`mentions/${mention.documentId}/claim`),
    onSuccess: () => router.refresh(),
  })
  const genDraft = useMutation({
    mutationFn: () => post(`mentions/${mention.documentId}/draft`),
    onSuccess: (data) => setDraft(data.data.draft),
  })
  const respond = useMutation({
    mutationFn: () =>
      post('responses', {
        data: {
          mentionDocumentId: mention.documentId,
          finalText,
          draftText: draft || undefined,
          notes: notes || undefined,
        },
      }),
    onSuccess: () => {
      setFinalText('')
      setNotes('')
      router.refresh()
    },
  })
  const correct = useMutation({
    mutationFn: () =>
      post(`mentions/${mention.documentId}/correct`, {
        sentimentLabel: corrLabel,
        topicIds: corrTopics,
        newTopics: newTopics.length ? newTopics : undefined,
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
            className="text-sm rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-1.5 font-medium"
          >
            Claim
          </button>
        )}
        {aiEnabled && (
          <button
            onClick={() => genDraft.mutate()}
            disabled={genDraft.isPending}
            className="text-sm rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5"
          >
            {genDraft.isPending ? 'Drafting…' : '✨ Generate docs-grounded draft'}
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
        <MutationError m={claim} className="text-xs" />
        <MutationError m={genDraft} className="text-xs" />
        <MutationError m={outcome} className="text-xs" />
      </div>

      {showAck && (
        <div className="rounded-lg border border-violet-300 dark:border-violet-800 p-4 space-y-3">
          <p className="text-sm font-medium">Close without a public reply</p>
          <p className="text-xs text-zinc-500">
            The mention leaves the queue but keeps feeding trends, themes, and reports. Use internal
            notes below to record the team&apos;s take.
          </p>
          <div className="flex gap-3 flex-wrap">
            {[
              { value: 'competitor', label: 'competitor (replying would look pushy)' },
              { value: 'not-relevant', label: 'not relevant' },
              { value: 'watching', label: 'watching (no reply needed yet)' },
              { value: 'own-post', label: 'our own post (kept out of sentiment metrics)' },
            ].map((r) => (
              <label key={r.value} className="text-sm flex items-center gap-1">
                <input type="radio" checked={ackReason === r.value} onChange={() => setAckReason(r.value)} />{' '}
                {r.label}
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
            className="text-sm rounded-md bg-violet-600 text-white px-3 py-1.5"
          >
            {acknowledge.isPending ? 'Saving…' : 'Acknowledge'}
          </button>
          {acknowledge.isError && <p className="text-sm text-red-600">{String(acknowledge.error)}</p>}
        </div>
      )}

      {showCorrect && (
        <div className="rounded-lg border border-violet-300 dark:border-violet-800 p-4 space-y-3">
          <p className="text-sm font-medium">
            {aiEnabled
              ? 'Human correction (never overwritten by re-analysis)'
              : 'Manual labeling (AI analysis is disabled — labels are set by the team)'}
          </p>
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
          <div className="flex gap-2 flex-wrap">
            {allTopics.map((t: any) => (
              <label key={t.documentId} className="text-xs flex items-center gap-1 border border-zinc-300 dark:border-zinc-700 rounded-full px-2 py-0.5">
                <input
                  type="checkbox"
                  checked={corrTopics.includes(t.documentId)}
                  onChange={(e) =>
                    setCorrTopics((prev) =>
                      e.target.checked ? [...prev, t.documentId] : prev.filter((id) => id !== t.documentId)
                    )
                  }
                />
                {t.name}
              </label>
            ))}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && topicDraft.trim()) {
                  e.preventDefault()
                  setNewTopics((prev) => [...new Set([...prev, topicDraft.trim()])])
                  setTopicDraft('')
                }
              }}
              placeholder="New topic name…"
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm"
            />
            <button
              onClick={() => {
                if (!topicDraft.trim()) return
                setNewTopics((prev) => [...new Set([...prev, topicDraft.trim()])])
                setTopicDraft('')
              }}
              className="text-sm rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5"
            >
              + Add topic
            </button>
            {newTopics.map((n) => (
              <span
                key={n}
                className="text-xs rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 px-2 py-0.5"
              >
                #{n} (new){' '}
                <button onClick={() => setNewTopics((prev) => prev.filter((x) => x !== n))}>✕</button>
              </span>
            ))}
          </div>
          <button
            onClick={() => correct.mutate()}
            disabled={correct.isPending}
            className="text-sm rounded-md bg-violet-600 text-white px-3 py-1.5"
          >
            Save correction
          </button>
          <MutationError m={correct} />
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <p className="text-sm font-medium">
          Record your reply (post it on the platform first — Pulse tracks it). For internal-only
          commentary, add a note in the timeline instead.
        </p>
        {draft && (
          <details className="group rounded border border-dashed border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-zinc-500 [&::-webkit-details-marker]:hidden">
              <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
              <span className="font-medium">
                Draft ready{mention.draftedVia ? ` · via ${mention.draftedVia}` : ''}
              </span>
              <span className="text-zinc-400">{draft.length} chars — click to read</span>
              <button
                onClick={(e) => {
                  e.preventDefault() // don't toggle the accordion
                  setFinalText(draft)
                }}
                className="ml-auto rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-white dark:border-zinc-600 dark:hover:bg-zinc-900"
              >
                Use this draft
              </button>
            </summary>
            <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{draft}</p>
          </details>
        )}
        <textarea
          value={finalText}
          onChange={(e) => setFinalText(e.target.value)}
          placeholder="What you actually replied…"
          rows={4}
          className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes (optional)"
          className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        />
        <button
          onClick={() => respond.mutate()}
          disabled={respond.isPending || !finalText.trim()}
          className="text-sm rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-1.5 font-medium disabled:opacity-50"
        >
          {respond.isPending ? 'Saving…' : 'Record response'}
        </button>
        {respond.isError && <p className="text-sm text-red-600">{String(respond.error)}</p>}
      </div>
    </div>
  )
}
