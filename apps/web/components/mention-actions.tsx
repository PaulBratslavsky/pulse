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

export default function MentionActions({ mention, allTopics }: { mention: any; allTopics: any[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState<string>('')
  const [finalText, setFinalText] = useState('')
  const [notes, setNotes] = useState('')
  const [showCorrect, setShowCorrect] = useState(false)
  const [corrLabel, setCorrLabel] = useState(mention.sentimentLabel ?? 'neutral')
  const [corrTopics, setCorrTopics] = useState<string[]>((mention.topics ?? []).map((t: any) => t.documentId))

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
        data: { mentionDocumentId: mention.documentId, finalText, draftText: draft || undefined, notes: notes || undefined },
      }),
    onSuccess: () => {
      setFinalText('')
      setNotes('')
      router.refresh()
    },
  })
  const correct = useMutation({
    mutationFn: () =>
      post(`mentions/${mention.documentId}/correct`, { sentimentLabel: corrLabel, topicIds: corrTopics }),
    onSuccess: () => {
      setShowCorrect(false)
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

  const lastResponse = (mention.responses ?? [])[mention.responses?.length - 1]

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
        <button
          onClick={() => genDraft.mutate()}
          disabled={genDraft.isPending}
          className="text-sm rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5"
        >
          {genDraft.isPending ? 'Drafting…' : '✨ Generate docs-grounded draft'}
        </button>
        <button
          onClick={() => setShowCorrect((v) => !v)}
          className="text-sm rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5"
        >
          Correct analysis
        </button>
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

      {showCorrect && (
        <div className="rounded-lg border border-violet-300 dark:border-violet-800 p-4 space-y-3">
          <p className="text-sm font-medium">Human correction (never overwritten by re-analysis)</p>
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
        <p className="text-sm font-medium">Record your reply (post it on the platform first — Pulse tracks it)</p>
        {draft && (
          <div className="rounded bg-zinc-50 dark:bg-zinc-800 p-3 text-sm whitespace-pre-wrap border border-dashed border-zinc-300 dark:border-zinc-700">
            <p className="text-xs font-medium text-zinc-400 mb-1">AI draft (edit below before posting)</p>
            {draft}
          </div>
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
