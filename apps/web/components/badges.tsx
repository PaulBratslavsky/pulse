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

export function StalenessFlag({ receivedAt, days = 2 }: { receivedAt?: string; days?: number }) {
  if (!receivedAt) return null
  const age = (Date.now() - new Date(receivedAt).getTime()) / 86400000
  if (age < days) return null
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-xs font-semibold bg-red-600 text-white">
      ⏰ {Math.floor(age)}d old
    </span>
  )
}
