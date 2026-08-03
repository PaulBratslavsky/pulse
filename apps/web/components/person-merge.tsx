'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'
import { Spinner } from '@/components/ui'

type Candidate = {
  documentId: string
  handle?: string | null
  displayName?: string | null
  identityKey: string
  identityProvisional: boolean
  channel?: string | null
  mentionCount?: number
  leadScore?: number
  because: string
}

/**
 * "Is this the same person?"
 *
 * The boot repair folds a handle-keyed row into the URL-keyed one on the same
 * channel automatically, because that is provably the same account. Everything
 * else — the same human on X and on Reddit — is a judgement, and this is where
 * a human makes it.
 *
 * Loaded on demand rather than with the page: most people have no candidates,
 * and a merge suggestion shown unprompted invites merging on faith. Each row
 * says WHY it is being suggested for the same reason.
 */
export default function PersonMerge({
  documentId,
  name,
}: {
  documentId: string
  name: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const candidates = useQuery<{ data: Candidate[] }>({
    queryKey: ['merge-candidates', documentId],
    queryFn: () => pulseFetch('GET', `people/${documentId}/merge-candidates`),
    enabled: open,
  })

  // The OTHER row is folded away, into this one — so the page you are looking
  // at is the one that survives. Merging in the other direction would navigate
  // you to a tombstone.
  const merge = useMutation({
    mutationFn: (loser: string) => pulseFetch('POST', `people/${loser}/merge`, { into: documentId }),
    onSuccess: () => {
      setOpen(false)
      router.refresh()
    },
  })

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <Users size={12} />
        Same person?
      </button>
    )
  }

  const rows = candidates.data?.data ?? []

  return (
    <div className="mt-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="mb-2 text-xs text-zinc-500">
        Folding one of these into <strong>{name}</strong> moves their mentions, notes and history
        here and rescores the result. The other row stops appearing on the board but is kept, so
        existing links still resolve.
      </p>

      {candidates.isPending && <Spinner size={12} />}
      {candidates.isSuccess && rows.length === 0 && (
        <p className="text-xs text-zinc-500">No one else shares this handle or display name.</p>
      )}

      <ul className="space-y-2">
        {rows.map((c) => (
          <li key={c.documentId} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{c.displayName ?? c.handle ?? c.identityKey}</span>
            <code className="text-xs text-zinc-500">{c.identityKey}</code>
            <span className="text-xs text-zinc-500">
              {c.channel ?? 'no channel'} · {c.mentionCount ?? 0} mention
              {c.mentionCount === 1 ? '' : 's'} · {c.because}
            </span>
            <button
              onClick={() => merge.mutate(c.documentId)}
              disabled={merge.isPending}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
            >
              {merge.isPending && <Spinner size={11} />}
              Merge into this person
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Cancel
        </button>
        <MutationError m={merge} className="text-xs" />
      </div>
    </div>
  )
}
