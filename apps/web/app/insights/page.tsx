import Link from 'next/link'
import { FileBarChart, TrendingUp, Tags, MessagesSquare } from 'lucide-react'

/**
 * Insights — placeholder for custom reports.
 * Planned: saved report definitions (period comparisons, per-channel breakdowns,
 * response-effectiveness), exportable summaries, scheduled report generation.
 */
export default function InsightsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-sm text-zinc-500">Custom reports over your mention data.</p>
      </div>

      <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
        <FileBarChart className="mx-auto mb-4 text-zinc-400" size={40} />
        <p className="text-lg font-medium mb-2">Custom reports live here soon</p>
        <p className="text-sm text-zinc-500 max-w-lg mx-auto mb-6">
          This is the home for saved and scheduled reports — period-over-period sentiment
          comparisons, per-channel breakdowns, response-effectiveness summaries, and exports for
          planning meetings. Until then, three ways to get insight today:
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
