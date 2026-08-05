'use client'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/ui/mutation-error'
import { Spinner } from '@/components/ui'

const STATUSES = ['new', 'watching', 'contacted', 'qualified', 'not-a-fit'] as const

/**
 * Lifecycle control, shared by the lead card and the person page so a
 * transition means the same thing (and logs the same activity) wherever it is
 * made. Moving off 'new' also claims the lead, the way claiming a mention does.
 */
export default function LeadStatus({
  documentId,
  status,
  owner,
}: {
  documentId: string
  status: string
  owner?: { username: string } | null
}) {
  const router = useRouter()
  const set = useMutation({
    mutationFn: (next: string) => pulseFetch('POST', `people/${documentId}/status`, { status: next }),
    onSuccess: () => router.refresh(),
  })

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={status}
        onChange={(e) => set.mutate(e.target.value)}
        disabled={set.isPending}
        // the card is a link; without this the select would navigate on click
        onClick={(e) => e.stopPropagation()}
        className="rounded-md border border-zinc-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {set.isPending && <Spinner size={14} />}
      {owner && <span className="text-xs text-zinc-500">{owner.username}</span>}
      <MutationError m={set} className="text-xs" />
    </span>
  )
}
