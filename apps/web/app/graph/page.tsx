import { redirect } from 'next/navigation'
import { Share2 } from 'lucide-react'
import { isAuthError, loaders } from '@/lib/loaders'
import { FilterPill, EmptyState } from '@/components/ui'
import GraphView from '@/components/insights/graph-view'
import type { TGraphProjection } from '@/types'

/**
 * Conversation map — the corpus as a network rather than a queue.
 *
 * Concepts are mined from mention text, linked when they appear together, then
 * clustered server-side. What it's for: seeing which concerns travel together,
 * which ideas bridge otherwise separate clusters, and which pairs of themes
 * nobody connects (the gaps — usually the content that hasn't been written).
 */

const WINDOWS = [30, 90, 365] as const

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ projection?: string; days?: string; color?: string }>
}) {
  const params = await searchParams
  const days = WINDOWS.includes(Number(params.days) as any) ? Number(params.days) : 90
  const colorBy = params.color === 'sentiment' ? 'sentiment' : 'cluster'

  const res = await loaders.getGraph({ projection: params.projection, days: String(days) })
  if (isAuthError(res)) redirect('/sign-in')
  // a 200 with no payload is a broken response, not an empty graph
  if (!res.success || !res.data) throw new Error(res.error?.message ?? 'failed to load the graph')

  const payload = res.data
  const projections: TGraphProjection[] = res.meta?.projections ?? []

  const url = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams()
    const projection = 'projection' in over ? over.projection : payload.projection
    const d = 'days' in over ? over.days : String(days)
    const c = 'color' in over ? over.color : colorBy
    if (projection && projection !== 'terms') q.set('projection', projection)
    if (d && d !== '90') q.set('days', d)
    if (c && c !== 'cluster') q.set('color', c)
    const s = q.toString()
    return s ? `/graph?${s}` : '/graph'
  }

  const active = projections.find((p) => p.id === payload.projection)

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Conversation map</h1>
          <p className="text-sm text-zinc-500">
            {active?.description ?? 'How the conversation around Strapi hangs together.'}
          </p>
        </div>
        <div className="flex gap-2 text-sm" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <FilterPill key={w} href={url({ days: String(w) })} active={days === w}>
              {w}d
            </FilterPill>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {projections.map((p) => (
          <FilterPill
            key={p.id}
            href={url({ projection: p.id })}
            active={payload.projection === p.id}
            title={p.description}
          >
            {p.label}
          </FilterPill>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-800" aria-hidden />
        <FilterPill href={url({ color: 'cluster' })} active={colorBy === 'cluster'} title="Colour nodes by cluster">
          by cluster
        </FilterPill>
        <FilterPill
          href={url({ color: 'sentiment' })}
          active={colorBy === 'sentiment'}
          title="Colour nodes by the average sentiment of the mentions they appear in"
        >
          by sentiment
        </FilterPill>
      </div>

      {payload.nodes.length === 0 ? (
        <EmptyState icon={<Share2 className="mx-auto mb-4 text-zinc-400" size={40} />} title="Nothing to map yet">
          <p className="mx-auto max-w-md text-sm text-zinc-500">
            {payload.projection === 'topics'
              ? 'Topics are only assigned when AI analysis runs, and a link needs two topics on one mention. Try the Concepts view — it reads the mention text directly and works without AI.'
              : 'Not enough mentions in this window to find structure. Try a longer window.'}
          </p>
        </EmptyState>
      ) : (
        <>
          <GraphView nodes={payload.nodes} edges={payload.edges} colorBy={colorBy} />

          <div className="mt-6 grid gap-3 lg:grid-cols-3">
            <Panel title="Clusters" hint="Themes discovered from how concepts co-occur — not a list anyone declared.">
              <ul className="space-y-2 text-sm">
                {payload.clusters.slice(0, 6).map((c: any) => (
                  <li key={c.id} className="flex items-baseline gap-2">
                    <span className="font-medium">{c.label}</span>
                    <span className="text-xs text-zinc-500">{c.size} concepts</span>
                    {c.avgSentiment != null && (
                      <span
                        className={`text-xs ${
                          c.avgSentiment < -0.15
                            ? 'text-red-600'
                            : c.avgSentiment > 0.15
                              ? 'text-emerald-600'
                              : 'text-zinc-400'
                        }`}
                      >
                        {c.avgSentiment > 0 ? '+' : ''}
                        {c.avgSentiment}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Bridges" hint="Concepts joining otherwise separate clusters — cross-cutting concerns.">
              <div className="flex flex-wrap gap-2">
                {payload.bridges.length === 0 && <p className="text-sm text-zinc-500">None yet.</p>}
                {payload.bridges.slice(0, 8).map((b: any) => (
                  <span
                    key={b.id}
                    className="rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    {b.label}
                  </span>
                ))}
              </div>
            </Panel>

            <Panel
              title="Gaps"
              hint="Cluster pairs the corpus barely connects — two things people discuss that nobody joins up."
            >
              <ul className="space-y-2 text-sm">
                {payload.gaps.length === 0 && (
                  <li className="text-sm text-zinc-500">Everything here is already connected.</li>
                )}
                {payload.gaps.slice(0, 5).map((g: any, i: number) => (
                  <li key={i} className="text-zinc-700 dark:text-zinc-300">
                    {g.a} <span className="text-zinc-400">↮</span> {g.b}
                    {g.bridges === 0 && <span className="ml-1 text-xs text-zinc-400">(no link)</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <p className="mt-4 text-xs text-zinc-500">
            {payload.stats.nodeCount} concepts · {payload.stats.edgeCount} links · from{' '}
            {payload.stats.mentionsConsidered} mentions in {payload.stats.windowDays} days
            {payload.stats.truncated && ' · trimmed to the strongest connections'}
          </p>
        </>
      )}
    </div>
  )
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mb-3 text-xs text-zinc-500">{hint}</p>
      {children}
    </div>
  )
}
