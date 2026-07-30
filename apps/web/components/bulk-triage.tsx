'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { CheckSquare, X, Keyboard } from 'lucide-react'
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
  focusedId: string | null
  openHelp: () => void
  bulkMode: boolean
  setBulkMode: (on: boolean) => void
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
  { value: 'own-post', label: 'our own post' },
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

  const [bulkMode, setBulkModeState] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [showHelp, setShowHelp] = useState(false)
  const focusedId = focusIndex >= 0 ? (allIds[focusIndex] ?? null) : null
  const stateRef = useRef({ focusIndex, selected, ackReason, topicId, bulkMode })
  stateRef.current = { focusIndex, selected, ackReason, topicId, bulkMode }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const clear = () => setSelected(new Set())
  const setBulkMode = (on: boolean) => {
    setBulkModeState(on)
    if (!on) setSelected(new Set())
  }
  const isSelected = (id: string) => selected.has(id)

  const run = useMutation({
    mutationFn: ({ ids, ...body }: any) =>
      pulseFetch<{ data: { succeeded: number; failed: number; results: any[] } }>('POST', 'mentions/bulk', {
        ...body,
        documentIds: ids ?? [...selected],
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

  /**
   * Triage keyboard layer (Gmail/Linear conventions). Actions apply to the
   * SELECTION when there is one, otherwise to the focused card — so a fast
   * pass is j/k + a/c/n without ever touching the mouse.
   * Never fires while typing: the global search box lives in the nav, so an
   * un-guarded listener would hijack every keystroke.
   */
  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const t = el as HTMLElement | null
      if (!t) return false
      const tag = t.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
    }

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const { focusIndex: fi, selected: sel, ackReason: reason, topicId: topic } = stateRef.current
      const focused = fi >= 0 ? allIds[fi] : null
      const targets = sel.size ? [...sel] : focused ? [focused] : []

      const move = (delta: number) => {
        e.preventDefault()
        setFocusIndex((prev) => {
          const next = Math.min(allIds.length - 1, Math.max(0, prev < 0 ? 0 : prev + delta))
          document
            .querySelector(`[data-mention-id="${allIds[next]}"]`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          return next
        })
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          return move(1)
        case 'k':
        case 'ArrowUp':
          return move(-1)
        case 'x':
          if (focused) {
            e.preventDefault()
            // selecting from the keyboard implies bulk mode — no need to
            // click the toggle first
            setBulkModeState(true)
            toggle(focused)
          }
          return
        case 'b':
          e.preventDefault()
          setBulkMode(!stateRef.current.bulkMode)
          return
        case 'a':
          if (targets.length) run.mutate({ ids: targets, action: 'acknowledge', reason })
          return
        case 'c':
          if (targets.length) run.mutate({ ids: targets, action: 'claim' })
          return
        case 'n':
          if (targets.length) run.mutate({ ids: targets, action: 'correct', sentimentLabel: 'na' })
          return
        case 't':
          if (targets.length && topic) run.mutate({ ids: targets, action: 'correct', topicIds: [topic] })
          return
        case 'o':
        case 'Enter':
          if (focused) {
            e.preventDefault()
            router.push(`/mentions/${focused}`)
          }
          return
        case 'Escape':
          clear()
          setShowHelp(false)
          return
        case '?':
          setShowHelp((v) => !v)
          return
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // allIds identity changes per render of the server component; that's fine —
    // the listener is cheap to re-register and always sees fresh ids
  }, [allIds, router, run, toggle, clear])

  const n = selected.size

  return (
    <SelectionContext.Provider
      value={{
        selected,
        toggle,
        clear,
        isSelected,
        focusedId,
        openHelp: () => setShowHelp(true),
        bulkMode,
        setBulkMode,
      }}
    >
      {children}

      {showHelp && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 flex items-center gap-2 font-medium">
              <Keyboard size={16} /> Triage shortcuts
            </h3>
            <dl className="space-y-1.5 text-sm">
              {[
                ['j / k', 'move down / up'],
                ['b', 'toggle bulk edit (checkboxes)'],
                ['x', 'select the focused mention (turns bulk edit on)'],
                ['a', 'acknowledge (selection, else focused)'],
                ['c', 'claim'],
                ['n', 'mark n/a — not about Strapi'],
                ['t', 'add the chosen topic'],
                ['o / Enter', 'open the focused mention'],
                ['Esc', 'clear selection'],
                ['?', 'toggle this help'],
              ].map(([k, label]) => (
                <div key={k} className="flex gap-3">
                  <dt className="w-24 shrink-0 font-mono text-xs text-zinc-500">{k}</dt>
                  <dd className="text-zinc-700 dark:text-zinc-300">{label}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-zinc-500">
              Shortcuts pause while you&apos;re typing in a field.
            </p>
          </div>
        </div>
      )}
      {/* bottom uses a safe-area max() so the bar clears the iOS home indicator */}
      {(n > 0 || result) && (
        <div className="sticky z-30 mt-4" style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
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
  const { isSelected, toggle, bulkMode } = useSelection()
  if (!bulkMode) return null
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
  const { selected, openHelp, bulkMode, setBulkMode } = useSelection()
  if (count === 0) return null
  return (
    <span className="inline-flex items-center gap-3 text-xs text-zinc-400">
      <button
        onClick={() => setBulkMode(!bulkMode)}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${
          bulkMode
            ? 'border-[#4945FF] bg-[#4945FF]/10 font-medium text-[#4945FF]'
            : 'border-zinc-300 hover:text-zinc-600 dark:border-zinc-700'
        }`}
        title="Show selection checkboxes for bulk triage (b)"
      >
        <CheckSquare size={12} /> {bulkMode ? `Bulk edit on${selected.size ? ` · ${selected.size}` : ''}` : 'Bulk edit'}
      </button>
      {selected.size === 0 && (
        <button onClick={openHelp} className="inline-flex items-center gap-1 underline hover:text-zinc-600">
          <Keyboard size={12} /> keyboard shortcuts
        </button>
      )}
    </span>
  )
}

/** Focus ring for the keyboard-focused card (j/k navigation). */
export function QueueCard({ documentId, children }: { documentId: string; children: React.ReactNode }) {
  const { focusedId, isSelected } = useSelection()
  const focused = focusedId === documentId
  return (
    <li
      data-mention-id={documentId}
      className={`rounded-lg border bg-white p-4 dark:bg-zinc-900 ${
        focused
          ? 'border-[#4945FF] ring-2 ring-[#4945FF]/30'
          : isSelected(documentId)
            ? 'border-[#4945FF]/50'
            : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      {children}
    </li>
  )
}
