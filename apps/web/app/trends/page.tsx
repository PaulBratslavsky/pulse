import { redirect } from 'next/navigation'
import { isAuthError, loaders } from '@/lib/loaders'
import EventForm from '@/components/insights/event-form'
import TrendChart from '@/components/insights/trend-chart'

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; topic?: string }>
}) {
  const params = await searchParams

  const trends = await loaders.getTrends(params)
  if (isAuthError(trends)) redirect('/sign-in')
  if (!trends.success) throw new Error(trends.error?.message ?? 'failed to load trends')

  // the chart is the page; the config only decides whether to offer AI copy,
  // so it defaults to on rather than taking the page down
  const configRes = await loaders.getInsightsConfig()
  if (isAuthError(configRes)) redirect('/sign-in')
  const config = configRes.data ?? { aiEnabled: true }

  const { series, events } = trends.data ?? { series: [], events: [] }
  const latest = [...series].reverse().find((p) => p.score != null)

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Trends</h1>
          <p className="text-sm text-zinc-500">
            The Pulse score: trailing-7-day volume-weighted sentiment, 0–100, UTC days.
          </p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-semibold">{latest?.score ?? '—'}</div>
          <div className="text-xs text-zinc-500">current Pulse score</div>
        </div>
      </div>

      {!config.aiEnabled && (
        <p className="mb-4 text-sm rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          Pulse AI is disabled — scores come from Octolens sentiment labels and manual labeling
          (provenance-stamped <code className="text-xs">modelVersion: octolens</code>). Set{' '}
          <code className="text-xs">AI_API_KEY</code> for Pulse&apos;s own analysis.
        </p>
      )}
      {series.every((p) => p.score == null) ? (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
          <p className="text-lg font-medium mb-1">Not enough data yet</p>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Pulse starts collecting from launch — the trend line appears as analyzed mentions
            accumulate. Check back after a few days of ingestion.
          </p>
        </div>
      ) : (
        <TrendChart series={series} events={events} />
      )}

      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h2 className="font-medium">Events in range</h2>
          {/* the annotation is written where the chart is read — that context
              is the whole reason this lives here and not only in admin */}
          <EventForm />
        </div>
        {events.length > 0 ? (
          <ul className="text-sm space-y-1">
            {events.map((e) => (
              <li key={e.documentId}>
                <span className="text-zinc-400">{new Date(e.date).toISOString().slice(0, 10)}</span>{' '}
                <span className="font-medium">{e.title}</span>{' '}
                <span className="text-xs text-zinc-500">({e.kind})</span>
                {e.notes && <span className="text-xs text-zinc-500"> — {e.notes}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">
            Nothing marked in this window. Adding releases and incidents makes a spike readable
            months later.
          </p>
        )}
      </section>
    </div>
  )
}
