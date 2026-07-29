'use client'

import { createContext, useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { CheckSquare, X } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'

/**
 * Bulk triage: the queue's answer to "ingest outruns one-at-a-time triage".
 * Selection lives in context so cards stay dumb checkboxes; the action bar
 * appears only when something is selected. Every action reuses the SAME
 * guarded workflow methods as the single-item paths — the server runs each
 * item in its own transaction and reports per item, so one illegal transition
 * (e.g. claiming an already-claimed mention) can't sink the batch.
 */
type Ctx = {
  selected: Set<string>
  toggle: (id: string) => void
  clear: () => void
  isSelected: (id: string) => boolean
}
const SelectionContext = createContext<Ctx | null>(null)

export function useSelection() {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection outside SelectionProvider')
  return ctx
}

const ACK_REASONS = [
  { value: 'competitor', label: 'competitor' },
  { value: 'not-relevant', label: 'not relevant' },
  { value: 'watching', label: 'watching' },
]

export function SelectionProvider({
  children,
  allIds,
  topics,
}: {
  children: React.ReactNode
  allIds: string[]
  topics: { documentId: string; name: string }[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<string | null>(null)
  const [ackReason, setAckReason] = useState('not-relevant')
  const [topicId, setTopicId] = useState('')

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const clear = () => setSelected(new Set())
  const isSelected = (id: string) => selected.has(id)

  const run = useMutation({
    mutationFn: (body: any) =>
      pulseFetch<{ data: { succeeded: number; failed: number; results: any[] } }>('POST', 'mentions/bulk', {
        ...body,
        documentIds: [...selected],
      }),
    onSuccess: (res) => {
      const { succeeded, failed, results } = res.data
      const firstError = results.find((r: any) => !r.ok)?.error
      setResult(
        failed
          ? `${succeeded} done · ${failed} skipped${firstError ? ` (${firstError})` : ''}`
          : `${succeeded} done`
      )
      clear()
      router.refresh()
      setTimeout(() => setResult(null), 6000)
    },
    onError: (err) => setResult(err instanceof Error ? err.message : 'bulk action failed'),
  })

  const n = selected.size

  return (
    <SelectionContext.Provider value={{ selected, toggle, clear, isSelected }}>
      {children}
      {(n > 0 || result) && (
        <div className="sticky bottom-4 z-30 mt-4">
          <div className="mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {n > 0 ? (
              <>
                <span className="font-medium">{n} selected</span>
                <button
                  onClick={() => setSelected(new Set(allIds))}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
                >
                  select page ({allIds.length})
                </button>
                <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

                <select
                  value={ackReason}
                  onChange={(e) => setAckReason(e.target.value)}
                  aria-label="Acknowledge reason"
                  className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {ACK_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => run.mutate({ action: 'acknowledge', reason: ackReason })}
                  disabled={run.isPending}
                  className="rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Acknowledge
                </button>

                <button
                  onClick={() => run.mutate({ action: 'correct', sentimentLabel: 'na' })}
                  disabled={run.isPending}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700"
                  title="Mark as not about Strapi — clears the score so it leaves the Pulse metrics"
                >
                  Mark n/a
                </button>
                <button
                  onClick={() => run.mutate({ action: 'claim' })}
                  disabled={run.isPending}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-700"
                >
                  Claim
                </button>

                {topics.length > 0 && (
                  <>
                    <select
                      value={topicId}
                      onChange={(e) => setTopicId(e.target.value)}
                      aria-label="Topic to add"
                      className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="">add topic…</option>
                      {topics.map((t) => (
                        <option key={t.documentId} value={t.documentId}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => run.mutate({ action: 'correct', topicIds: [topicId] })}
                      disabled={run.isPending || !topicId}
                      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
                    >
                      Apply
                    </button>
                  </>
                )}

                <button onClick={clear} className="ml-1 text-zinc-500" aria-label="Clear selection">
                  <X size={14} />
                </button>
              </>
            ) : null}
            {run.isPending && <span className="text-xs text-zinc-500">working…</span>}
            {result && <span className="text-xs text-zinc-600 dark:text-zinc-400">{result}</span>}
          </div>
        </div>
      )}
    </SelectionContext.Provider>
  )
}

/** Per-card checkbox. */
export function SelectCheckbox({ documentId }: { documentId: string }) {
  const { isSelected, toggle } = useSelection()
  return (
    <label className="inline-flex cursor-pointer items-center" title="Select for bulk triage">
      <input
        type="checkbox"
        checked={isSelected(documentId)}
        onChange={() => toggle(documentId)}
        className="h-4 w-4 accent-[#4945FF]"
        aria-label="Select mention"
      />
    </label>
  )
}

/** Small header affordance so the feature is discoverable when nothing is selected. */
export function SelectionHint({ count }: { count: number }) {
  const { selected } = useSelection()
  if (selected.size > 0 || count === 0) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
      <CheckSquare size={12} /> select mentions for bulk triage
    </span>
  )
}
