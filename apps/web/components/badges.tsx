const sentimentStyles: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  negative: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const statusStyles: Record<string, string> = {
  unanswered: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  claimed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  answered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  resolved: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  acknowledged: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
}

export function SentimentBadge({ label }: { label?: string | null }) {
  const key = label ?? 'unscored'
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${sentimentStyles[key] ?? sentimentStyles.neutral}`}>
      {key}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${statusStyles[status] ?? statusStyles.unanswered}`}>
      {status}
    </span>
  )
}

export function PostedDate({ postedAt }: { postedAt?: string | null }) {
  if (!postedAt) return null
  const d = new Date(postedAt)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return (
    <span className="text-xs text-zinc-500">
      {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}
    </span>
  )
}

/** Age is measured from when the comment was PUBLISHED on the platform
 *  (postedAt), not when Pulse ingested it — a synced backlog item that has
 *  gone unanswered for weeks must flag immediately. */
export function StalenessFlag({ postedAt, days = 2 }: { postedAt?: string; days?: number }) {
  if (!postedAt) return null
  const age = (Date.now() - new Date(postedAt).getTime()) / 86400000
  if (age < days) return null
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-xs font-semibold bg-red-600 text-white">
      ⏰ {Math.floor(age)}d old
    </span>
  )
}
