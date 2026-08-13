import { redirect } from 'next/navigation'
import { isAuthError, loaders } from '@/lib/loaders'
import ThemeList from '@/components/insights/theme-list'

/**
 * Themes — the topic vocabulary ranked by volume × negativity.
 *
 * The server fetches the ranked set; ThemeList owns search / kind / paging.
 * That split is deliberate: the list is small enough to filter in memory, so
 * typing filters instantly instead of costing a round-trip per keystroke.
 */
export default async function ThemesPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; q?: string; kind?: string }>
}) {
  const params = await searchParams
  const res = await loaders.getThemes({ window: params.window })
  if (isAuthError(res)) redirect('/sign-in')
  if (!res.success) throw new Error(res.error?.message ?? 'failed to load themes')
  const { windowDays, themes } = res.data ?? { windowDays: 30, themes: [] }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Themes</h1>
        <p className="text-sm text-zinc-500">
          Recurring topics over the last {windowDays} days, ranked by volume × negativity — the
          product feedback pipeline.
        </p>
      </div>

      <ThemeList themes={themes} initialQuery={params.q ?? ''} initialKind={params.kind ?? ''} />
    </div>
  )
}
