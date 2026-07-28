'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'

async function post(path: string, body?: unknown) {
  const res = await fetch(`/api/pulse/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? 'request failed')
  return res.json()
}

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
  // a draft saved via MCP/chat (pulse-save-draft) pre-fills the reply form
  const [draft, setDraft] = useState<string>(mention.draftText ?? '')
  const [finalText, setFinalText] = useState(mention.draftText ?? '')
  const [notes, setNotes] = useState('')
  const [internal, setInternal] = useState(false)
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
    onSuccess: (data) => {
      setDraft(data.data.draft)
      if (!finalText) setFinalText(data.data.draft)
    },
  })
  const respond = useMutation({
    mutationFn: () =>
      post('responses', {
        data: {
          mentionDocumentId: mention.documentId,
          finalText,
          draftText: draft || undefined,
          notes: notes || undefined,
          internal,
        },
      }),
    onSuccess: () => {
      setFinalText('')
      setNotes('')
      setInternal(false)
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
    mutationFn: async ({ responseId, result }: { responseId: string; result: string }) => {
      const res = await fetch(`/api/pulse/responses/${responseId}/outcome`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ result }),
      })
      if (!res.ok) throw new Error('outcome failed')
    },
    onSuccess: () => router.refresh(),
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
          <div className="flex gap-2">
            {['positive', 'neutral', 'negative'].map((l) => (
              <label key={l} className="text-sm flex items-center gap-1">
                <input type="radio" checked={corrLabel === l} onChange={() => setCorrLabel(l)} /> {l}
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
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <p className="text-sm font-medium">
          {internal
            ? 'Internal note (searchable team commentary — no public reply, status unchanged)'
            : 'Record your reply (post it on the platform first — Pulse tracks it)'}
        </p>
        {draft && (
          <div className="rounded bg-zinc-50 dark:bg-zinc-800 p-3 text-sm whitespace-pre-wrap border border-dashed border-zinc-300 dark:border-zinc-700">
            <p className="text-xs font-medium text-zinc-400 mb-1">
              Draft{mention.draftedVia ? ` via ${mention.draftedVia}` : ' (AI)'} — edit below, post on the
              platform, then record
            </p>
            {draft}
          </div>
        )}
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
          Internal note only (no public reply — e.g. competitor threads)
        </label>
        <textarea
          value={finalText}
          onChange={(e) => setFinalText(e.target.value)}
          placeholder={internal ? 'The team’s take on this mention…' : 'What you actually replied…'}
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
          {respond.isPending ? 'Saving…' : internal ? 'Save internal note' : 'Record response'}
        </button>
        {respond.isError && <p className="text-sm text-red-600">{String(respond.error)}</p>}
      </div>
    </div>
  )
}
