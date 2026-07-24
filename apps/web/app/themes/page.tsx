import Link from 'next/link'
import { redirect } from 'next/navigation'
import { strapiFetch, qs } from '@/lib/strapi'

export default async function ThemesPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>
}) {
  const params = await searchParams
  let data: any
  try {
    data = await strapiFetch('/api/insights/themes' + qs({ window: params.window }))
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }
  const { windowDays, themes } = data.data

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Themes</h1>
        <p className="text-sm text-zinc-500">
          Recurring topics over the last {windowDays} days, ranked by volume × negativity — the
          product feedback pipeline.
        </p>
      </div>

      {themes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
          <p className="text-lg font-medium mb-1">No themes yet</p>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Themes appear once analyzed mentions accumulate topics. Greenfield data — give it a few
            days.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {themes.map((t: any) => (
            <li key={t.topic.slug} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-medium">#{t.topic.name}</span>
                <span className="text-xs text-zinc-500">{t.topic.kind}</span>
                <span className="text-sm">{t.mentions} mentions</span>
                <span className={`text-sm font-medium ${t.negativeShare >= 50 ? 'text-red-600' : 'text-zinc-500'}`}>
                  {t.negativeShare}% negative
                </span>
                <span className="text-sm text-zinc-500">avg score {t.avgScore}</span>
                <Link href={`/?sentiment=negative`} className="ml-auto text-sm text-blue-600 hover:underline">
                  view queue →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
