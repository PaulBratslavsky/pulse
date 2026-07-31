import { strapiFetch } from '@/lib/strapi'
import MutedAuthors from '@/components/muted-authors'
import ClassificationPanel from '@/components/classification-panel'
import LeaderboardOptOut from '@/components/leaderboard-optout'

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1338'

export default async function SettingsPage() {
  const [muted, prefs, classification] = await Promise.all([
    strapiFetch('/api/muted-authors?sort=updatedAt:desc&pagination[pageSize]=100').catch(() => ({ data: [] })),
    strapiFetch('/api/preferences/me').catch(() => ({ data: { hideFromLeaderboard: false } })),
    strapiFetch('/api/analysis/status').catch(() => ({
      data: { enabled: false, provider: '', model: '', unclassified: 0, budget: { spent: 0, budget: 0, exceeded: false } },
    })),
  ])

  const links = [
    { href: `${STRAPI_URL}/admin`, label: 'Strapi admin panel', note: 'accounts, roles, dead letters' },
    { href: `${STRAPI_URL}/admin/content-manager/collection-types/api::topic.topic`, label: 'Curate topics', note: 'rename / merge machine-created topics' },
    { href: `${STRAPI_URL}/admin/content-manager/collection-types/api::event.event`, label: 'Events', note: 'releases, launches, incidents for trend annotations' },
    { href: `${STRAPI_URL}/admin/content-manager/collection-types/api::channel.channel`, label: 'Channels', note: 'platform keys the webhook maps to' },
    { href: `${STRAPI_URL}/admin/content-manager/collection-types/api::dead-letter.dead-letter`, label: 'Dead letters', note: 'ingest payloads that failed validation (replayable)' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Settings</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Noise control lives here; the rest of the configuration lives in the Strapi admin panel —
        Pulse doesn&apos;t duplicate CRUD UI.
      </p>

      {/* classification first: it describes what happens to every mention.
          Muting is a narrower, author-specific action. Keeping them in separate
          cards stops "Rescan history" reading as "re-run analysis". */}
      <div className="mb-4">
        <ClassificationPanel status={classification.data} />
      </div>

      <div className="mb-4">
        <MutedAuthors muted={muted.data ?? []} />
      </div>

      <div className="mb-8">
        <LeaderboardOptOut hidden={Boolean(prefs.data?.hideFromLeaderboard)} />
      </div>

      <h2 className="font-medium mb-3">Admin panel</h2>
      <ul className="space-y-3">
        {links.map((l) => (
          <li key={l.href} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <a href={l.href} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">
              {l.label} ↗
            </a>
            <p className="text-sm text-zinc-500">{l.note}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
