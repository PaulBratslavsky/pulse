'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Ban, RotateCcw } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'

const REASON_LABEL: Record<string, string> = {
  'ai-spam': 'AI-generated spam',
  'promo-spam': 'promotional spam',
  irrelevant: 'irrelevant',
  other: 'other',
}

/** Manage the shadow-block list: add a handle, unmute (which restores their
 *  mentions to the queue and to reports). Nothing is ever deleted. */
export default function MutedAuthors({ muted }: { muted: any[] }) {
  const router = useRouter()
  const [handle, setHandle] = useState('')
  const [reason, setReason] = useState('ai-spam')

  const add = useMutation({
    mutationFn: () => pulseFetch('POST', 'muted-authors/mute', { handle: handle.trim().replace(/^@/, ''), reason }),
    onSuccess: () => {
      setHandle('')
      router.refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (documentId: string) => pulseFetch('DELETE', `muted-authors/${documentId}/unmute`),
    onSuccess: () => router.refresh(),
  })

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <h2 className="font-medium mb-1 flex items-center gap-2">
        <Ban size={16} className="text-zinc-400" /> Muted authors
      </h2>
      <p className="text-sm text-zinc-500 mb-4">
        Shadow-blocked: their mentions are still stored and searchable, but never reach the queue and
        never count toward trends, themes, or the Pulse score. Unmuting restores them.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && handle.trim()) {
              e.preventDefault()
              add.mutate()
            }
          }}
          placeholder="author handle (without @)"
          className="w-56 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          aria-label="Mute reason"
        >
          {Object.entries(REASON_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button
          onClick={() => add.mutate()}
          disabled={add.isPending || !handle.trim()}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {add.isPending ? 'Muting…' : 'Mute author'}
        </button>
        <MutationError m={add} className="text-xs" />
      </div>

      {muted.length === 0 ? (
        <p className="text-sm text-zinc-500">No muted authors yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {muted.map((m: any) => (
            <li key={m.documentId} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-medium">@{m.handle}</span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {REASON_LABEL[m.reason] ?? m.reason}
              </span>
              <span className="text-xs text-zinc-500">
                {m.mentionCount ?? 0} mention{(m.mentionCount ?? 0) === 1 ? '' : 's'} hidden
              </span>
              {m.note && <span className="text-xs text-zinc-400 truncate">{m.note}</span>}
              <button
                onClick={() => remove.mutate(m.documentId)}
                disabled={remove.isPending}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
                title="Unmute — restores their mentions to the queue and reports"
              >
                <RotateCcw size={11} /> Unmute
              </button>
            </li>
          ))}
        </ul>
      )}
      <MutationError m={remove} className="mt-2 text-xs" />
    </div>
  )
}
