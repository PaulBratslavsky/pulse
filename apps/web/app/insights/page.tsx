import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileBarChart, TrendingUp, Tags, MessagesSquare, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { strapiFetch } from '@/lib/strapi'
import { FilterPill } from '@/components/ui'

/**
 * Insights — snapshot report (7/30/90d) over the mention data, with the
 * saved/scheduled-reports placeholder below it.
 * Viz notes: stat tiles for headline numbers; a segmented status bar for
 * sentiment (labels carry identity, never color alone, 2px surface gaps);
 * single-hue bar lists (Strapi blurple) for per-teammate and per-channel
 * magnitude, every row direct-labeled with name + value in text ink.
 */

const BLURPLE = '#4945FF'
const WINDOWS = [7, 30, 90] as const

const sentimentMeta: Record<string, { label: string; className: string }> = {
  positive: { label: 'positive', className: 'bg-emerald-500' },
  neutral: { label: 'neutral', className: 'bg-zinc-400 dark:bg-zinc-500' },
  negative: { label: 'negative', className: 'bg-red-500' },
  na: { label: 'n/a (off-topic)', className: 'bg-zinc-300 dark:bg-zinc-600' },
  unscored: { label: 'unscored', className: 'bg-zinc-200 dark:bg-zinc-700' },
}
const sentimentFallback = { label: 'other', className: 'bg-zinc-200 dark:bg-zinc-700' }

function StatTile({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      {/* fixed two-line label zone so every tile's number sits on the same baseline */}
      <p className="text-xs text-zinc-500 mb-1 min-h-[2rem]">{label}</p>
      <p className="text-2xl font-semibold tabular-nums leading-none">{value}</p>
      <p className="text-xs text-zinc-500 mt-2 min-h-[1rem]">{detail}</p>
    </div>
  )
}

function BarList({ title, rows }: { title: string; rows: { name: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <h3 className="text-sm font-medium mb-3">{title}</h3>
      {rows.length === 0 && <p className="text-sm text-zinc-500">Nothing in this window.</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 text-sm">
            <span className="truncate text-zinc-700 dark:text-zinc-300">{r.name}</span>
            <span className="h-2.5 rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <span
                className="block h-full rounded"
                style={{ width: `${(r.count / max) * 100}%`, backgroundColor: BLURPLE }}
              />
            </span>
            <span className="text-right tabular-nums text-zinc-500 text-xs">{r.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>
}) {
  const params = await searchParams
  const days = WINDOWS.includes(Number(params.window) as any) ? Number(params.window) : 30

  let snap: any
  try {
    snap = (await strapiFetch(`/api/insights/snapshot?days=${days}`)).data
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }

  const sentimentEntries = Object.entries(snap.mentions.bySentiment as Record<string, number>).filter(
    ([, n]) => n > 0
  )
  const sentimentTotal = sentimentEntries.reduce((s, [, n]) => s + n, 0)

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Insights</h1>
          <p className="text-sm text-zinc-500">Snapshot of the last {days} days.</p>
        </div>
        <div className="flex gap-2 text-sm" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <FilterPill key={w} href={w === 30 ? '/insights' : `/insights?window=${w}`} active={days === w}>
              {w}d
            </FilterPill>
          ))}
        </div>
      </div>

      {/* headline tiles — statuses match the queue filters one-to-one */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-6">
        <StatTile
          label="Mentions"
          value={snap.mentions.total}
          detail={`${snap.mentions.answeredRate}% got a reply`}
        />
        <StatTile
          label="Answered"
          value={snap.mentions.byStatus.answered ?? 0}
          detail="replied — outcome pending"
        />
        <StatTile
          label="Resolved"
          value={snap.mentions.byStatus.resolved ?? 0}
          detail="replied & closed out"
        />
        <StatTile
          label="Acknowledged (no reply)"
          value={snap.mentions.byStatus.acknowledged ?? 0}
          detail={
            snap.mentions.acknowledgedByReason.length
              ? snap.mentions.acknowledgedByReason.map((r: any) => `${r.name} ${r.count}`).join(' · ')
              : undefined
          }
        />
        <StatTile
          label="Median time to answer"
          value={
            snap.responses.medianHoursToAnswer == null
              ? '—'
              : snap.responses.medianHoursToAnswer >= 48
                ? `${Math.round(snap.responses.medianHoursToAnswer / 24)}d`
                : `${snap.responses.medianHoursToAnswer}h`
          }
          detail={`${snap.responses.total} replies recorded`}
        />
        <StatTile
          label="Pulse score"
          value={snap.pulse.current ?? '—'}
          detail={
            snap.pulse.delta == null ? (
              'no trend yet'
            ) : (
              <span className="inline-flex items-center gap-1">
                {snap.pulse.delta >= 0 ? (
                  <ArrowUpRight size={12} className="text-emerald-600" />
                ) : (
                  <ArrowDownRight size={12} className="text-red-600" />
                )}
                {snap.pulse.delta >= 0 ? '+' : ''}
                {snap.pulse.delta} vs window start
              </span>
            )
          }
        />
      </div>

      {/* sentiment mix — segmented status bar, identity carried by the labels below */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-medium">Sentiment mix</h3>
          {snap.mentions.avgScore != null && (
            <span className="text-xs text-zinc-500">avg score {snap.mentions.avgScore} (−1…+1)</span>
          )}
        </div>
        {sentimentTotal === 0 ? (
          <p className="text-sm text-zinc-500">No mentions in this window.</p>
        ) : (
          <>
            <div className="flex h-3 gap-0.5 overflow-hidden rounded">
              {sentimentEntries.map(([key, n]) => (
                <div
                  key={key}
                  className={`${(sentimentMeta[key] ?? sentimentFallback).className} rounded-sm`}
                  style={{ width: `${(n / sentimentTotal) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-2 flex gap-4 flex-wrap text-xs text-zinc-600 dark:text-zinc-400">
              {sentimentEntries.map(([key, n]) => (
                <span key={key} className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${(sentimentMeta[key] ?? sentimentFallback).className}`} />
                  {(sentimentMeta[key] ?? sentimentFallback).label} {n} ({Math.round((n / sentimentTotal) * 100)}%)
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2 mb-10">
        <BarList title="Replies by teammate" rows={snap.responses.byUser} />
        <BarList title="Mentions by channel" rows={snap.mentions.byChannel} />
      </div>

      {/* saved/scheduled reports — still to come, kept below the snapshot */}
      <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
        <FileBarChart className="mx-auto mb-4 text-zinc-400" size={40} />
        <p className="text-lg font-medium mb-2">Custom reports live here soon</p>
        <p className="text-sm text-zinc-500 max-w-lg mx-auto mb-6">
          This is the home for saved and scheduled reports — period-over-period sentiment
          comparisons, competitor breakdowns, response-effectiveness summaries, and exports for
          planning meetings. Until then, three ways to dig deeper:
        </p>
        <div className="flex justify-center gap-3 flex-wrap">
          <Link
            href="/trends"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <TrendingUp size={16} /> Pulse score over time
          </Link>
          <Link
            href="/themes"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Tags size={16} /> Recurring themes
          </Link>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <MessagesSquare size={16} /> Ask the data (chat)
          </Link>
        </div>
      </div>
    </div>
  )
}
