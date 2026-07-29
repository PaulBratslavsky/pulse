import Link from 'next/link'
import { ArrowRight, MessageSquare, Eye, ListChecks } from 'lucide-react'
import { strapiFetch, qs } from '@/lib/strapi'
import { SentimentBadge } from '@/components/badges'
import { Avatar } from '@/components/ui'

/** Celebration stats as icon chips: a 330px rail can't carry a sentence like
 *  "31 replies · 85 acknowledged · 21 resolved · 41 labeled" without wrapping
 *  badly and truncating names. Icon + number, with the word in the tooltip.
 *  Only non-zero categories render. */
const WORK: Array<{ key: string; Icon: any; label: string }> = [
  // chat bubble, not an envelope — these are public replies, not email
  { key: 'replies', Icon: MessageSquare, label: 'replies posted' },
  // an open eye: acknowledged means "we saw it and closed it", not "we hid it"
  { key: 'acknowledged', Icon: Eye, label: 'acknowledged (closed without a reply)' },
  { key: 'triaged', Icon: ListChecks, label: 'triaged (claimed, labeled, resolved, notes, drafts)' },
]

/** Shared column template: avatar · name · three stat columns. Both the team
 *  totals line and each teammate row use it, which is what makes the icons
 *  line up in columns down the panel. */
const ROW = 'grid grid-cols-[1.25rem_1fr_repeat(3,2.75rem)] items-center gap-x-1.5'

/** One stat cell. Always occupies its grid column even at zero — that is what
 *  keeps the icon columns aligned down the whole panel — but renders empty
 *  rather than printing a row of noisy 0s. */
function StatCell({ row, stat }: { row: any; stat: (typeof WORK)[number] }) {
  const n = row?.[stat.key] ?? 0
  if (n === 0) return <span aria-hidden />
  const { Icon, label } = stat
  return (
    <span className="inline-flex items-center gap-1 text-zinc-500" title={`${n} ${label}`}>
      <Icon size={12} className="shrink-0" aria-hidden />
      <span className="tabular-nums text-zinc-700 dark:text-zinc-300">{n}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** DevFlow-style right rail: needs-attention mentions + top topics. */
export async function RightSidebar() {
  let attention: any[] = []
  let themes: any[] = []
  let leaders: any[] = []
  let team: any = {}
  try {
    const [mentions, themesRes, boardRes] = await Promise.all([
      strapiFetch(
        '/api/mentions' +
          qs({
            'filters[status][$eq]': 'unanswered',
            sort: 'postedAt:asc',
            'pagination[pageSize]': 5,
          })
      ),
      strapiFetch('/api/insights/themes?window=30'),
      strapiFetch('/api/insights/leaderboard?days=7').catch(() => ({ data: { leaders: [] } })),
    ])
    attention = mentions.data ?? []
    themes = (themesRes.data?.themes ?? []).slice(0, 6)
    leaders = (boardRes.data?.leaders ?? []).slice(0, 8)
    team = boardRes.data?.team ?? team
  } catch {
    return null
  }

  return (
    <aside className="sticky right-0 top-16 flex h-[calc(100vh-4rem)] w-[330px] flex-col gap-8 overflow-y-auto bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 p-6 pt-10 max-xl:hidden">
      <div>
        <h3 className="text-lg font-bold mb-4">Needs attention</h3>
        <div className="flex flex-col gap-4">
          {attention.length === 0 && (
            <p className="text-sm text-zinc-500">Queue is clear 🎉</p>
          )}
          {attention.map((m: any) => (
            <Link
              key={m.documentId}
              href={`/mentions/${m.documentId}`}
              className="flex items-start gap-2 group"
            >
              <ArrowRight size={16} className="mt-1 shrink-0 text-zinc-400 group-hover:text-[#4945FF]" />
              <span className="text-sm text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-950 dark:group-hover:text-white line-clamp-2">
                <SentimentBadge label={m.sentimentLabel} />{' '}
                {m.content}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold mb-1">Team celebration 🎉</h3>
        {/* What WE did, then who chipped in. Everyone with activity is listed,
            replies shown even at zero — opting out is the escape hatch. */}
        {WORK.some((w) => (team?.[w.key] ?? 0) > 0) ? (
          // The team totals line and every teammate row use the SAME fixed
          // column template, so the stat icons line up vertically down the
          // panel instead of drifting with each row's content. Per-row grids
          // (rather than one big one) keep the list semantics — and a real
          // element per teammate — while giving identical alignment.
          // no medals, no rank numbers — a contribution list, not a competition
          // (team decision 2026-07-29)
          <>
            <p className={`${ROW} text-xs text-zinc-500 mb-3`}>
              <span className="col-span-2">Last 7 days</span>
              {WORK.map((w) => (
                <StatCell key={w.key} row={team} stat={w} />
              ))}
            </p>
            <ol className="flex flex-col gap-3">
              {leaders.map((u: any) => (
                <li key={u.username} className={`${ROW} text-xs`}>
                  <Avatar name={u.username} size="sm" />
                  <span className="min-w-0 truncate text-sm text-zinc-700 dark:text-zinc-300">
                    {u.username}
                  </span>
                  {WORK.map((w) => (
                    <StatCell key={w.key} row={u} stat={w} />
                  ))}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="mb-4 text-sm text-zinc-500">
            Nothing yet this week — first one on the board sets the pace 🙂
          </p>
        )}
      </div>

      <div>
        <h3 className="text-lg font-bold mb-4">Top topics</h3>
        <div className="flex flex-wrap gap-2">
          {themes.length === 0 && <p className="text-sm text-zinc-500">No topics yet.</p>}
          {themes.map((t: any) => (
            <Link
              key={t.topic.slug}
              href={`/?topic=${encodeURIComponent(t.topic.slug)}`}
              className="inline-flex items-center gap-2 rounded-md bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-[#4945FF]"
            >
              #{t.topic.name}
              <span className="text-zinc-400">{t.mentions}</span>
            </Link>
          ))}
        </div>
      </div>
    </aside>
  )
}
