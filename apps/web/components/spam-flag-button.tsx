'use client'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Flag, FlagOff } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'

/**
 * Manual spam judgement. Distinct from muting the author: this flags THIS post
 * (heuristics only ever mark suspected-spam automatically), while muting
 * applies retroactively to everything that author has posted and will post.
 */
export default function SpamFlagButton({
  documentId,
  quality,
  compact = false,
}: {
  documentId: string
  quality?: string
  compact?: boolean
}) {
  const router = useRouter()
  const flagged = quality === 'suspected-spam' || quality === 'spam'

  const set = useMutation({
    mutationFn: (next: string) => pulseFetch('POST', `mentions/${documentId}/quality`, { quality: next }),
    onSuccess: () => router.refresh(),
  })

  const size = compact ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'
  const icon = compact ? 11 : 14

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() => set.mutate(flagged ? 'normal' : 'suspected-spam')}
        disabled={set.isPending}
        className={`inline-flex items-center gap-1 rounded-md border ${size} ${
          flagged
            ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
            : 'border-zinc-300 text-zinc-500 hover:border-amber-400 hover:text-amber-700 dark:border-zinc-700'
        }`}
        title={
          flagged
            ? 'Clear the spam flag — this post is legitimate'
            : 'Flag as possible spam: promotional or AI-generated. Stays in the queue for review; muting the author is the stronger action.'
        }
      >
        {flagged ? <FlagOff size={icon} /> : <Flag size={icon} />}
        {flagged ? 'Not spam' : 'Possible spam'}
      </button>
      <MutationError m={set} className="text-xs" />
    </span>
  )
}
