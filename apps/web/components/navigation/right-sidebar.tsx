import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { strapiFetch, qs } from '@/lib/strapi'
import { SentimentBadge } from '@/components/badges'
import { Avatar } from '@/components/ui'

/** DevFlow-style right rail: needs-attention mentions + top topics. */
export async function RightSidebar() {
  let attention: any[] = []
  let themes: any[] = []
  let leaders: any[] = []
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
    leaders = (boardRes.data?.leaders ?? []).slice(0, 5)
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
        <h3 className="text-lg font-bold mb-1">This week</h3>
        <p className="mb-3 text-xs text-zinc-500">Replies posted in the last 7 days</p>
        {leaders.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity yet — be first.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {leaders.map((u: any, i: number) => (
              <li key={u.username} className="flex items-center gap-2 text-sm">
                <span className="w-5 shrink-0 text-center" aria-hidden>
                  {['🥇', '🥈', '🥉'][i] ?? <span className="text-xs text-zinc-400">{i + 1}</span>}
                </span>
                <Avatar name={u.username} size="sm" />
                <span className="truncate text-zinc-700 dark:text-zinc-300">{u.username}</span>
                <span className="ml-auto flex items-baseline gap-1.5 shrink-0">
                  <span className="font-semibold tabular-nums">{u.replies}</span>
                  <span className="text-xs text-zinc-400">
                    {u.replies === 1 ? 'reply' : 'replies'}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
        {leaders.some((u: any) => u.triaged > 0) && (
          <p className="mt-2 text-xs text-zinc-400">
            plus {leaders.reduce((n: number, u: any) => n + u.triaged, 0)} triage actions
            {leaders.reduce((n: number, u: any) => n + u.resolved, 0) > 0 &&
              ` · ${leaders.reduce((n: number, u: any) => n + u.resolved, 0)} resolved`}
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
