'use client'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Flag, FlagOff } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/ui/mutation-error'

/**
 * Manual spam judgement. Distinct from muting the author: this flags THIS post
 * (heuristics only ever mark suspected-spam automatically), while muting
 * applies retroactively to everything that author has posted and will post.
 */
export default function SpamFlagButton({
  documentId,
  quality,
  qualityReason,
  qualityVia,
  compact = false,
}: {
  documentId: string
  quality?: string
  qualityReason?: string | null
  qualityVia?: string | null
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
    <span className="inline-flex items-start gap-1">
      <button
        onClick={() => set.mutate(flagged ? 'normal' : 'suspected-spam')}
        disabled={set.isPending}
        // no-wrap only in the detail view. There the 400-char reason sits
        // beside the button and squeezed "Not spam" onto two lines. On the
        // queue card the button is compact and MUST stay shrinkable — pinning
        // it there pushed the action row past a 412px phone and put the whole
        // page into horizontal scroll.
        className={`inline-flex items-center gap-1 rounded-md border ${compact ? '' : 'shrink-0 whitespace-nowrap'} ${size} ${
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
      {/* why it was flagged, so confirming is a read rather than a re-judge */}
      {flagged && qualityReason && !compact && (
        // min-w-0 + break-words so a 400-char reason wraps inside its column
        // instead of widening the row; the button beside it never shrinks.
        <span className="min-w-0 break-words text-xs leading-snug text-zinc-500">
          {qualityReason}
          {qualityVia && qualityVia !== 'app' && (
            <span className="text-zinc-400"> · via {qualityVia}</span>
          )}
        </span>
      )}
      <MutationError m={set} className="text-xs" />
    </span>
  )
}
