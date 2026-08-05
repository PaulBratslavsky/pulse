'use client'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/ui/mutation-error'
import { Spinner } from '@/components/ui'

/**
 * Automatic classification controls.
 *
 * Its own card, deliberately: this used to be adjacent to "Rescan history" in
 * the Muted authors panel, where it read as though re-scanning re-ran analysis.
 * Muting is a decision about an AUTHOR; classification is about the corpus.
 */
export default function ClassificationPanel({
  status,
}: {
  status: {
    enabled: boolean
    provider: string
    model: string
    counts: { missing: number; fallbackOnly: number }
    budget: { spent: number; budget: number; exceeded: boolean }
  }
}) {
  const router = useRouter()
  const reclassify = useMutation({
    mutationFn: (scope: 'missing' | 'fallback') =>
      pulseFetch('POST', 'analysis/reclassify', { scope }),
    onSuccess: () => router.refresh(),
  })

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 flex items-center gap-2 font-medium">
        <Sparkles size={16} className="text-zinc-400" />
        Automatic classification
      </h2>
      <p className="mb-4 text-sm text-zinc-500">
        Every ingested mention is labelled for sentiment, topics, routing lane and spam within about
        a minute of arriving. Nothing you have corrected by hand is ever overwritten. The model can
        only <em>flag</em> spam for review; confirming it stays a human decision.
      </p>

      {!status.enabled ? (
        <p className="text-sm text-zinc-500">
          Disabled. Set <code className="text-xs">AI_API_KEY</code> on the backend to turn it on —
          mentions fall back to Octolens sentiment and rule-based routing until then.
        </p>
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-zinc-500">Model</dt>
              <dd className="truncate" title={`${status.provider} / ${status.model}`}>
                {status.model}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Tokens today</dt>
              <dd className={status.budget.exceeded ? 'text-red-600' : ''}>
                {status.budget.spent.toLocaleString()}
                {status.budget.budget > 0 && ` / ${status.budget.budget.toLocaleString()}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Missing a score</dt>
              <dd>{status.counts.missing.toLocaleString()}</dd>
            </div>
          </dl>

          {status.budget.exceeded && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              Daily token budget spent — classification pauses and resumes tomorrow. Mentions stay
              queued, nothing is lost.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {/* only rows with NO score — pressing this repeatedly never
                re-spends on mentions that already carry a label */}
            <button
              onClick={() => reclassify.mutate('missing')}
              disabled={reclassify.isPending || status.counts.missing === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
              title="Only mentions with no sentiment score at all"
            >
              {reclassify.isPending && <Spinner size={12} />}
              {status.counts.missing === 0
                ? 'Everything has a score'
                : `Classify ${status.counts.missing.toLocaleString()} missing a score`}
            </button>
            {status.counts.fallbackOnly > 0 && (
              <button
                onClick={() => reclassify.mutate('fallback')}
                disabled={reclassify.isPending}
                className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300"
                title="These already have a coarse Octolens score but no model-assigned lane or topics — a one-off upgrade, not something to repeat"
              >
                also upgrade {status.counts.fallbackOnly.toLocaleString()} Octolens-labelled
              </button>
            )}
            <MutationError m={reclassify} className="text-xs" />
          </div>

          {reclassify.isSuccess && (
            <p className="mt-2 text-xs text-zinc-500">
              Re-queued — the sweep works through them in the background, about 20 a minute.
            </p>
          )}
        </>
      )}
    </div>
  )
}
