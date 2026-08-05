'use client'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { UserCheck } from 'lucide-react'
import { pulseFetch, PulseApiError } from '@/lib/pulse-client'
import { MutationError } from '@/components/ui/mutation-error'
import { Spinner } from '@/components/ui'

/**
 * "That's ours" — one click for a mention that is actually our own reply,
 * picked up because it names Strapi.
 *
 * It acknowledges with reason `own-post`, which already means exactly this and
 * is excluded from every metric: our own posts are positive by construction,
 * so counting them inflates our own score. The route existed, it just took
 * three clicks through the acknowledge panel — from the queue, where you
 * recognise your own handle, it should take one.
 */
export default function OwnPostButton({
  documentId,
  compact = false,
}: {
  documentId: string
  compact?: boolean
}) {
  const router = useRouter()
  const mark = useMutation({
    mutationFn: () =>
      pulseFetch('POST', `mentions/${documentId}/acknowledge`, { reason: 'own-post' }),
    onSuccess: () => router.refresh(),
    // 409 = someone already closed it; show reality rather than an error
    onError: (err) => {
      if (err instanceof PulseApiError && err.status === 409) router.refresh()
    },
  })

  const size = compact ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() => mark.mutate()}
        disabled={mark.isPending}
        className={`inline-flex items-center gap-1 rounded-md border border-zinc-300 text-zinc-500 hover:border-sky-400 hover:text-sky-700 disabled:opacity-50 dark:border-zinc-700 ${size} max-sm:min-h-[38px]`}
        title="This is one of our own posts — closes it and keeps it out of the sentiment metrics"
      >
        {mark.isPending ? <Spinner size={compact ? 11 : 12} /> : <UserCheck size={compact ? 11 : 14} />}
        {mark.isPending ? 'Marking…' : 'Ours'}
      </button>
      <MutationError m={mark} className="text-xs" />
    </span>
  )
}
