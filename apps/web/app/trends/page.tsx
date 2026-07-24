import { redirect } from 'next/navigation'
import { strapiFetch, qs } from '@/lib/strapi'
import TrendChart from '@/components/trend-chart'

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; topic?: string }>
}) {
  const params = await searchParams
  let data: any
  try {
    data = await strapiFetch('/api/insights/trends' + qs(params))
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }
  const { series, events } = data.data
  const latest = [...series].reverse().find((p: any) => p.score != null)

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

      {series.every((p: any) => p.score == null) ? (
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

      {events.length > 0 && (
        <section className="mt-8">
          <h2 className="font-medium mb-2">Events in range</h2>
          <ul className="text-sm space-y-1">
            {events.map((e: any) => (
              <li key={e.documentId}>
                <span className="text-zinc-400">{new Date(e.date).toISOString().slice(0, 10)}</span>{' '}
                <span className="font-medium">{e.title}</span>{' '}
                <span className="text-xs text-zinc-500">({e.kind})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
