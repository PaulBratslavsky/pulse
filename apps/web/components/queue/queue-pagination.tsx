import Link from 'next/link'

import type { TPagination } from '@/types'

/**
 * One end of the pager. Was a ternary per side choosing between a Link and a
 * greyed span; the two arms differed only in whether the href was live, so the
 * decision belongs in one place rather than twice in the JSX.
 */
function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) {
    return (
      <span className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-400">
        {children}
      </span>
    )
  }
  return (
    <Link
      href={href}
      className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      {children}
    </Link>
  )
}

export function QueuePagination({
  pagination,
  pageUrl,
}: {
  pagination: TPagination
  pageUrl: (p: number) => string
}) {
  if (pagination.pageCount <= 1) return null

  const prev = pagination.page > 1 ? pageUrl(pagination.page - 1) : null
  const next = pagination.page < pagination.pageCount ? pageUrl(pagination.page + 1) : null

  return (
    <nav className="mt-6 flex items-center justify-center gap-4 text-sm" aria-label="Pagination">
      <PageLink href={prev}>← Prev</PageLink>
      <span className="text-zinc-500">
        Page {pagination.page} of {pagination.pageCount} · {pagination.total} mentions
      </span>
      <PageLink href={next}>Next →</PageLink>
    </nav>
  )
}
