import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ExternalLink, IdCard, Users } from 'lucide-react'
import { strapiFetch } from '@/lib/strapi'
import { Avatar, EmptyState } from '@/components/ui'
import PeopleSearch from '@/components/people-search'

const FILTERS = [
  { key: '', label: 'everyone' },
  { key: 'started', label: 'has a profile' },
  { key: 'reachable', label: 'reachable' },
  { key: 'none', label: 'no profile' },
] as const

/**
 * The people directory.
 *
 * Deliberately not the Leads board. That one answers "who is worth looking at",
 * ordered by a score that decays; this answers "where is the person I am
 * already thinking of", ordered by recency and searched by name. Sorting a
 * directory by lead score makes it useless for the second question, and listing
 * all 480 people on the board makes it useless for the first.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; profile?: string; status?: string }>
}) {
  const params = await searchParams
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.profile) query.set('profile', params.profile)
  if (params.status) query.set('status', params.status)

  let data: any
  try {
    data = await strapiFetch(`/api/people?${query.toString()}`)
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    throw err
  }
  const people = data.data ?? []

  const href = (patch: Record<string, string>) => {
    const next = new URLSearchParams(query)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    const s = next.toString()
    return s ? `/people?${s}` : '/people'
  }

  return (
    <div>
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-semibold">
        <Users size={20} className="text-zinc-400" />
        People
      </h1>
      <p className="mb-5 text-sm text-zinc-500">
        Everyone we have heard from, whether or not they score as a lead. One row per human — an
        account on X and an account on Reddit are the same person here.
      </p>

      <PeopleSearch initial={params.q ?? ''} />

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = (params.profile ?? '') === f.key
          return (
            <Link
              key={f.key || 'all'}
              href={href({ profile: f.key })}
              className={`rounded-full border px-3 py-1 text-xs ${
                active
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
              }`}
            >
              {f.label}
            </Link>
          )
        })}
      </div>

      {people.length === 0 ? (
        <EmptyState
          icon={<Users className="mx-auto mb-4 text-zinc-400" size={40} />}
          title={params.q ? `Nobody matches “${params.q}”` : 'No people yet'}
        >
          <p className="text-sm text-zinc-500">
            {params.q
              ? 'Search covers display names, every handle they post under, and the company or email on their profile.'
              : 'People appear as soon as mentions arrive.'}
          </p>
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {people.map((p: any) => (
            <li
              key={p.documentId}
              className="rounded-lg border border-zinc-200 bg-white p-3 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
            >
              <div className="flex flex-wrap items-start gap-3">
                <Avatar name={p.displayName ?? p.handle ?? '?'} src={p.avatarUrl ?? undefined} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/leads/${p.documentId}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {p.displayName ?? `@${p.handle}`}
                    </Link>
                    {/* every presence, so the row reads as one human with N
                        accounts rather than whichever handle happened to win */}
                    {(p.aliases ?? []).map((a: any) => (
                      <span key={a.identityKey} className="text-xs text-zinc-500">
                        {a.profileUrl ? (
                          <a
                            href={a.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 underline underline-offset-2"
                          >
                            @{a.handle} <ExternalLink size={10} />
                          </a>
                        ) : (
                          <>@{a.handle}</>
                        )}
                        {a.channelName ? ` · ${a.channelName}` : ''}
                      </span>
                    ))}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span>
                      {p.mentionCount} {p.mentionCount === 1 ? 'mention' : 'mentions'}
                    </span>
                    {p.lastSeenAt && <span>last seen {new Date(p.lastSeenAt).toLocaleDateString()}</span>}
                    {p.leadScore > 0 && (
                      <span>
                        lead {p.leadBand} · {p.leadScore}
                      </span>
                    )}
                    <span>{p.status}</span>
                    {p.owner && <span>owned by {p.owner.username}</span>}
                  </div>
                </div>

                <span className="shrink-0 text-xs">
                  {p.profile?.started ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                        p.profile.hasEmail
                          ? 'border-emerald-400 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
                          : 'border-amber-400 text-amber-800 dark:border-amber-800 dark:text-amber-300'
                      }`}
                    >
                      <IdCard size={10} />
                      {p.profile.hasEmail ? 'reachable' : 'no email'}
                      {p.profile.company ? ` · ${p.profile.company}` : ''}
                    </span>
                  ) : (
                    <Link
                      href={`/leads/${p.documentId}?profile=1`}
                      className="text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
                    >
                      start a profile
                    </Link>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
