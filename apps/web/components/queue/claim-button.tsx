'use client'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { pulseFetch, PulseApiError } from '@/lib/pulse-client'
import { MutationError } from '@/components/ui/mutation-error'
import { Spinner } from '@/components/ui'

export default function ClaimButton({ documentId }: { documentId: string }) {
  const router = useRouter()
  const claim = useMutation({
    mutationFn: () => pulseFetch('POST', `mentions/${documentId}/claim`),
    onSuccess: () => router.refresh(),
    // a 409 means the page is stale (someone else claimed/closed it) — refresh
    // so the card shows reality instead of failing silently
    onError: (err) => {
      if (err instanceof PulseApiError && err.status === 409) router.refresh()
    },
  })
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={() => claim.mutate()}
        disabled={claim.isPending}
        className="inline-flex items-center gap-1.5 text-sm rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-1 font-medium disabled:opacity-50"
      >
        {claim.isPending && <Spinner size={12} />}
        {claim.isPending ? 'Claiming…' : 'Claim'}
      </button>
      <MutationError m={claim} className="text-xs" />
    </span>
  )
}
