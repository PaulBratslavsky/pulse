'use client'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'

export default function ClaimButton({ documentId }: { documentId: string }) {
  const router = useRouter()
  const claim = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pulse/mentions/${documentId}/claim`, { method: 'POST' })
      if (!res.ok) throw new Error('claim failed')
    },
    onSuccess: () => router.refresh(),
  })
  return (
    <button
      onClick={() => claim.mutate()}
      disabled={claim.isPending}
      className="text-sm rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-1 font-medium disabled:opacity-50"
    >
      {claim.isPending ? 'Claiming…' : 'Claim'}
    </button>
  )
}
