import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { strapiFetch, qs } from '@/lib/strapi'
import { SentimentBadge } from '@/components/badges'

/** DevFlow-style right rail: needs-attention mentions + top topics. */
export async function RightSidebar() {
  let attention: any[] = []
  let themes: any[] = []
  try {
    const [mentions, themesRes] = await Promise.all([
      strapiFetch(
        '/api/mentions' +
          qs({
            'filters[status][$eq]': 'unanswered',
            sort: 'receivedAt:asc',
            'pagination[pageSize]': 5,
          })
      ),
      strapiFetch('/api/insights/themes?window=30'),
    ])
    attention = mentions.data ?? []
    themes = (themesRes.data?.themes ?? []).slice(0, 6)
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
              <ArrowRight size={16} className="mt-1 shrink-0 text-zinc-400 group-hover:text-rose-500" />
              <span className="text-sm text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-950 dark:group-hover:text-white line-clamp-2">
                <SentimentBadge label={m.sentimentLabel} />{' '}
                {m.content}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold mb-4">Top topics</h3>
        <div className="flex flex-wrap gap-2">
          {themes.length === 0 && <p className="text-sm text-zinc-500">No topics yet.</p>}
          {themes.map((t: any) => (
            <span
              key={t.topic.slug}
              className="inline-flex items-center gap-2 rounded-md bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              #{t.topic.name}
              <span className="text-zinc-400">{t.mentions}</span>
            </span>
          ))}
        </div>
      </div>
    </aside>
  )
}
