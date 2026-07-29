'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'

/** Participation in the weekly board is optional — one toggle, no explanation
 *  required, and opting out never hides your work from the team totals. */
export default function LeaderboardOptOut({ hidden }: { hidden: boolean }) {
  const router = useRouter()
  const [on, setOn] = useState(!hidden)

  const save = useMutation({
    mutationFn: (next: boolean) => pulseFetch('PUT', 'preferences/me', { hideFromLeaderboard: !next }),
    onSuccess: () => router.refresh(),
  })

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <h2 className="font-medium mb-1">Weekly board</h2>
      <p className="text-sm text-zinc-500 mb-3">
        The &ldquo;This week&rdquo; panel celebrates replies the team posted. It&apos;s meant to be
        encouraging, not a performance record — showing up on it is entirely optional, and your work
        still counts toward the team total either way.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked)
            save.mutate(e.target.checked)
          }}
          className="h-4 w-4 accent-[#4945FF]"
        />
        Show me on the weekly board
      </label>
      <MutationError m={save} className="mt-2 text-xs" />
    </div>
  )
}
