import { redirect } from 'next/navigation'
import { Target } from 'lucide-react'
import { strapiFetch } from '@/lib/strapi'
import { FilterPill, EmptyState, FilterRow } from '@/components/ui'
import LeadCard from '@/components/leads/lead-card'

const BANDS = [
  { key: '', label: 'All' },
  { key: 'hot', label: 'Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'watch', label: 'Watch' },
]

const STATUSES = [
  { key: '', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'watching', label: 'Watching' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'not-a-fit', label: 'Not a fit' },
]

/**
 * Leads — people, not mentions.
 *
 * Everything else in Pulse is organised around a post. This is the one surface
 * organised around a human, because that is the unit you actually work: you
 * reach out to a person once, not to each of their posts.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ band?: string; status?: string; direction?: string }>
}) {
  const params = await searchParams
  const q = new URLSearchParams()
  if (params.band) q.set('band', params.band)
  if (params.status) q.set('status', params.status)
  if (params.direction) q.set('direction', params.direction)

  let leads: any[]
  try {
    leads = (await strapiFetch(`/api/people/leads?${q}`)).data ?? []
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }

  const url = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams()
    const merged = { band: params.band, status: params.status, direction: params.direction, ...over }
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v)
    const s = next.toString()
    return s ? `/leads?${s}` : '/leads'
  }

  const leaving = leads.filter((l) => l.direction === 'away-from-us').length

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Leads</h1>
      <p className="mb-5 max-w-2xl text-sm text-zinc-500">
        People with an open decision about their own stack, ranked by how strong and how recent the
        signal is. A lead only appears here when the classifier put one of their posts in the lead
        lane — naming a competitor is corroboration, never enough on its own.
      </p>

      {/* one row per filter axis: stacking them into a single wrap made it
          impossible to see which axis a pill belonged to */}
      <div className="mb-5 space-y-2">
        <FilterRow label="Strength">
          {BANDS.map((b) => (
            <FilterPill key={b.key || 'all'} href={url({ band: b.key })} active={(params.band ?? '') === b.key}>
              {b.label}
            </FilterPill>
          ))}
        </FilterRow>
        <FilterRow label="Status">
          {STATUSES.map((s) => (
            <FilterPill key={s.key || 'all'} href={url({ status: s.key })} active={(params.status ?? '') === s.key}>
              {s.label}
            </FilterPill>
          ))}
        </FilterRow>
        <FilterRow label="Direction">
          {[
            { key: '', label: 'All' },
            { key: 'toward-us', label: 'Toward us' },
            { key: 'open', label: 'Undecided' },
            { key: 'away-from-us', label: 'Leaving' },
          ].map((d) => (
            <FilterPill
              key={d.key || 'all'}
              href={url({ direction: d.key })}
              active={(params.direction ?? '') === d.key}
              title={
                d.key === 'away-from-us'
                  ? 'Someone moving off Strapi. High intent pointing the other way — worth knowing, not worth a pitch.'
                  : undefined
              }
            >
              {d.label}
            </FilterPill>
          ))}
        </FilterRow>
      </div>

      {leaving > 0 && !params.direction && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          {leaving} of these are moving <strong>away</strong> from Strapi. They score high because
          the intent is real — the direction is on the card, so check it before reaching out.
        </p>
      )}

      {leads.length === 0 ? (
        <EmptyState icon={<Target className="mx-auto mb-3 text-zinc-400" size={28} />} title="No leads match">
          <p className="mx-auto max-w-lg text-sm text-zinc-500">
            Leads are created by classification, not by hand. If this is empty everywhere, check that
            classification is running in Settings.
          </p>
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-zinc-500">
            {leads.length} {leads.length === 1 ? 'person' : 'people'}
          </p>
          <ul className="space-y-3">
            {leads.map((lead) => (
              <li key={lead.documentId}>
                <LeadCard lead={lead} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
