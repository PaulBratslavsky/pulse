'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { pulseFetch } from '@/lib/pulse-client'

/** Triggers the Octolens pull-sync (24h lookback) and refreshes the queue. */
export default function SyncButton() {
  const router = useRouter()
  const [summary, setSummary] = useState<string | null>(null)

  const sync = useMutation({
    mutationFn: async () =>
      (await pulseFetch<{ data: { created: number; seen: number } }>('POST', 'octolens/sync', { lookbackHours: 24 })).data,
    onSuccess: (data) => {
      setSummary(data.created > 0 ? `${data.created} new` : 'up to date')
      router.refresh()
      setTimeout(() => setSummary(null), 5000)
    },
    onError: () => {
      setSummary('sync failed')
      setTimeout(() => setSummary(null), 5000)
    },
  })

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => sync.mutate()}
        disabled={sync.isPending}
        className="text-sm rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
        title="Pull new mentions from Octolens now (last 24h)"
      >
        {sync.isPending ? 'Syncing…' : '↻ Sync'}
      </button>
      {summary && <span className="text-xs text-zinc-500">{summary}</span>}
    </div>
  )
}
