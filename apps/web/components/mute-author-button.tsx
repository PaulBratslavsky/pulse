'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Ban } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'

const REASONS = [
  { value: 'ai-spam', label: 'AI-generated spam' },
  { value: 'promo-spam', label: 'promotional spam' },
  { value: 'irrelevant', label: 'irrelevant' },
  { value: 'other', label: 'other' },
]

/** Shadow-block an author: their mentions (past and future) stop reaching the
 *  queue and stop counting in analytics — nothing is deleted. */
export default function MuteAuthorButton({ handle, compact = false }: { handle: string; compact?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('ai-spam')

  const mute = useMutation({
    mutationFn: () => pulseFetch('POST', 'muted-authors/mute', { handle, reason }),
    onSuccess: () => {
      setOpen(false)
      router.refresh()
    },
  })

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-md border border-zinc-300 text-zinc-500 hover:border-red-400 hover:text-red-600 dark:border-zinc-700 ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'
        }`}
        title={`Mute @${handle} — hides their mentions from the queue and all reports`}
      >
        <Ban size={compact ? 11 : 14} /> Mute author
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs dark:border-red-800 dark:bg-red-900/20">
      <span className="text-zinc-700 dark:text-zinc-300">Mute @{handle}?</span>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        aria-label="Mute reason"
      >
        {REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => mute.mutate()}
        disabled={mute.isPending}
        className="rounded bg-red-600 px-2 py-0.5 font-medium text-white"
      >
        {mute.isPending ? '…' : 'Mute'}
      </button>
      <button onClick={() => setOpen(false)} className="text-zinc-500">
        cancel
      </button>
      <MutationError m={mute} className="text-[10px]" />
    </span>
  )
}
