import { loaders } from '@/lib/loaders'
import MutedAuthors from '@/components/settings/muted-authors'
import ClassificationPanel from '@/components/settings/classification-panel'
import LeaderboardOptOut from '@/components/settings/leaderboard-optout'
import McpServers from '@/components/settings/mcp-servers'
import LeadScoring from '@/components/settings/lead-scoring'

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1338'

export default async function SettingsPage() {
  // Every panel here degrades independently: one endpoint being down should
  // cost you that panel, not the whole settings page.
  const [mutedRes, prefsRes, classificationRes, mcpRes, leadsRes] = await Promise.all([
    loaders.getMutedAuthors(),
    loaders.getMyPreferences(),
    loaders.getAnalysisStatus(),
    loaders.getMcpServers(),
    loaders.getLeadsStatus(),
  ])

  const muted = mutedRes.data ?? []
  const prefs = prefsRes.data ?? { hideFromLeaderboard: false }
  const classification = classificationRes.data ?? {
    enabled: false,
    provider: '',
    model: '',
    counts: { missing: 0, fallbackOnly: 0 },
    budget: { spent: 0, budget: 0, exceeded: false },
  }
  const mcp = mcpRes.data ?? []
  const leads = leadsRes.data ?? {
    scored: 0,
    hot: 0,
    warm: 0,
    lastScoredAt: null,
    staleCount: 0,
  }

  const links = [
    { href: `${STRAPI_URL}/admin`, label: 'Strapi admin panel', note: 'accounts, roles, dead letters' },
    { href: `${STRAPI_URL}/admin/content-manager/collection-types/api::topic.topic`, label: 'Curate topics', note: 'rename / merge machine-created topics' },
    { href: `${STRAPI_URL}/admin/content-manager/collection-types/api::event.event`, label: 'Events', note: 'releases, launches, incidents for trend annotations' },
    { href: `${STRAPI_URL}/admin/content-manager/collection-types/api::team-handle.team-handle`, label: 'Our handles', note: 'accounts that are ours — never spam, never reply work. Add a teammate here rather than in code' },
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
        <ClassificationPanel status={classification} />
      </div>

      {/* directly under classification: both describe what the model can do,
          and connecting the docs server is the single biggest quality lever on
          drafted replies */}
      <div className="mb-4">
        <McpServers servers={mcp} />
      </div>

      {/* after classification, because it consumes what classification produces:
          lanes in, per-person intent scores out. Its own card so a free action
          never sits inside the one that shows a token budget. */}
      <div className="mb-4">
        <LeadScoring status={leads} />
      </div>

      <div className="mb-4">
        <MutedAuthors muted={muted} />
      </div>

      <div className="mb-8">
        <LeaderboardOptOut hidden={Boolean(prefs.hideFromLeaderboard)} />
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
