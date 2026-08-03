'use client'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Target } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'
import { Spinner } from '@/components/ui'

type LeadsStatus = {
  scored: number
  hot: number
  warm: number
  lastScoredAt: string | null
  staleCount: number
}

/**
 * Lead scoring — deliberately NOT part of the classification card.
 *
 * Everything in that card spends tokens and shows a budget; this spends
 * nothing, and a free action sitting beside a metered one reads as metered.
 * They are also different jobs: the lane (including `lead`) is decided by the
 * SAME model call that does sentiment and topics, so there is no second
 * classification pass to run here. What this recomputes is the person-level
 * score, which is arithmetic over rows already stored.
 *
 * Why it needs a button at all: intent decays with the age of the post, but a
 * score is only written when something touches that person — so the board drifts
 * out of date by doing nothing. The nightly cron handles the general case; this
 * is the escape hatch after you re-route a batch of mentions by hand.
 */
export default function LeadScoring({ status }: { status: LeadsStatus }) {
  const router = useRouter()
  const rescore = useMutation({
    mutationFn: () => pulseFetch('POST', 'people/rescore'),
    onSuccess: () => router.refresh(),
  })

  const last = status.lastScoredAt ? new Date(status.lastScoredAt) : null
  const hoursAgo = last ? Math.floor((Date.now() - last.getTime()) / 3_600_000) : null

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 flex items-center gap-2 font-medium">
        <Target size={16} className="text-zinc-400" />
        Lead scoring
      </h2>
      <p className="mb-4 text-sm text-zinc-500">
        Which lane a mention belongs to is decided by the classification above, in the same pass as
        sentiment. This is the separate step: turning those lanes into a per-person intent score.
        It runs nightly, and re-running it costs <strong>nothing</strong> — no model call, no tokens.
      </p>

      <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500">People scored</dt>
          <dd>
            {status.scored.toLocaleString()}
            {status.scored > 0 && (
              <span className="text-zinc-500"> · {status.hot} hot, {status.warm} warm</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Last rescored</dt>
          <dd>
            {hoursAgo === null
              ? 'never'
              : hoursAgo < 1
                ? 'under an hour ago'
                : `${hoursAgo}h ago`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Scored over a day ago</dt>
          <dd>{status.staleCount.toLocaleString()}</dd>
        </div>
      </dl>

      {status.staleCount > 0 && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Intent fades with the age of the post — full weight for 14 days, then down to zero at 90.
          A score that has not been recomputed since it was written is showing the value it had that
          day, not today&apos;s.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => rescore.mutate()}
          disabled={rescore.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
          title="Recompute every person's intent score from their mentions — no model call"
        >
          {rescore.isPending && <Spinner size={12} />}
          {rescore.isPending ? 'Rescoring…' : 'Rescore leads'}
        </button>
        <MutationError m={rescore} className="text-xs" />
      </div>
    </div>
  )
}
