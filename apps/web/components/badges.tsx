const sentimentStyles: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  negative: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  // no strikethrough: 'n/a' means "not about Strapi", a deliberate and correct
  // classification, whereas a struck-through label reads as retracted or
  // invalid. It was a rare edge case when this was written; with automatic
  // classification it is now the majority of a competitor-heavy corpus, and a
  // third of the queue looking crossed out reads as damage. Muted grey already
  // carries "excluded from the numbers".
  na: 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500',
}

/** enum value `na` renders as "n/a" (slash isn't enum-safe in Strapi) */
const sentimentDisplay: Record<string, string> = { na: 'n/a' }

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
      {sentimentDisplay[key] ?? key}
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

/** Age since the comment was PUBLISHED on the platform (postedAt), not since
 *  Pulse ingested it. Always visible so age never appears "from nowhere":
 *  neutral gray under the SLA threshold, red alarm once it crosses it. */
export function StalenessFlag({
  postedAt,
  days = 2,
  awaitingReply = true,
}: {
  postedAt?: string
  days?: number
  /** red SLA style only applies while the mention still needs action */
  awaitingReply?: boolean
}) {
  if (!postedAt) return null
  const age = (Date.now() - new Date(postedAt).getTime()) / 86400000
  if (age < 0) return null
  const label = age < 1 ? `${Math.max(1, Math.floor(age * 24))}h old` : `${Math.floor(age)}d old`
  const breached = awaitingReply && age >= days
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${
        breached ? 'bg-red-600 text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
      }`}
      title={breached ? `unanswered past the ${days}-day SLA` : 'time since published'}
    >
      {breached ? '⏰ ' : ''}
      {label}
    </span>
  )
}

/**
 * Routing lane. `respond` is deliberately NOT rendered: it is the default view,
 * so a badge on every row would be noise. `lead` is the point — someone
 * shopping or leaving a competitor, usually with no Strapi keyword in the text
 * — and `monitor` explains why a mention is here when you go looking for it.
 *
 * The reason rides in the tooltip so a surprising route is explainable without
 * opening the mention.
 */
const laneStyles: Record<string, string> = {
  lead: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  monitor: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
}

export function LaneBadge({ lane, reason }: { lane?: string; reason?: string | null }) {
  if (!lane || lane === 'respond') return null
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${laneStyles[lane] ?? laneStyles.monitor}`}
      title={reason ? `${lane} — ${reason}` : lane}
    >
      {lane}
    </span>
  )
}
