import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { isAuthError, loaders } from '@/lib/loaders'
import SavedResources from '@/components/resources/saved-resources'
import BlogSearch from '@/components/resources/blog-search'

/**
 * Resources: the posts we send people to.
 *
 * Two panes over one idea. "Saved" is Pulse's own list — the subset of the
 * marketing blog the team decided is worth linking, with a note on why. "Find
 * on the blog" searches the marketing site live, and saving a result copies it
 * into that list. Pulse never mirrors the whole blog: what is not saved here is
 * not suggested anywhere else.
 *
 * The blog query lives in the URL (?view=find&q=…), so a search can be shared
 * or reloaded, and it is submitted rather than typed-through: every search is a
 * round trip to the marketing site.
 */
export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>
}) {
  const params = await searchParams
  const view = params.view === 'find' ? 'find' : 'saved'
  const q = (params.q ?? '').trim()
  const page = Math.max(1, Number(params.page) || 1)

  const [savedRes, searchRes] = await Promise.all([
    loaders.getResources(),
    view === 'find' && q.length >= 2 ? loaders.searchBlog(q, page) : Promise.resolve(null),
  ])
  if (isAuthError(savedRes)) redirect('/sign-in')
  const saved = savedRes.data ?? []
  const visibleCount = saved.filter((r) => !r.hidden).length

  const tab = (key: 'saved' | 'find', label: string) => (
    <Link
      href={key === 'saved' ? '/resources' : `/resources?view=find${q ? `&q=${encodeURIComponent(q)}` : ''}`}
      aria-current={view === key ? 'page' : undefined}
      className={
        view === key
          ? 'rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
      }
    >
      {label}
    </Link>
  )

  return (
    <div>
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-semibold">
        <BookOpen size={20} className="text-zinc-400" />
        Resources
      </h1>
      <p className="mb-5 text-sm text-zinc-500">
        Blog posts worth sending people to. Find them on the marketing site, save the good ones,
        and they become the list Pulse suggests when you reply.
      </p>

      <nav className="mb-5 flex gap-1" aria-label="Resources view">
        {tab('saved', `Saved (${visibleCount})`)}
        {tab('find', 'Find on the blog')}
      </nav>

      {!savedRes.success ? (
        <p className="text-sm text-red-600">Could not load saved resources: {savedRes.error?.message ?? 'unknown error'}</p>
      ) : view === 'saved' ? (
        <SavedResources resources={saved} />
      ) : (
        <BlogSearch
          q={q}
          page={page}
          result={
            searchRes && {
              ok: searchRes.success,
              status: searchRes.status,
              error: searchRes.error?.message ?? null,
              results: searchRes.data ?? [],
              pageCount: searchRes.meta?.pagination?.pageCount ?? 1,
              total: searchRes.meta?.pagination?.total ?? (searchRes.data ?? []).length,
            }
          }
        />
      )}
    </div>
  )
}
