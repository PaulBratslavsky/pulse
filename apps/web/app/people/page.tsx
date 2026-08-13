import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ExternalLink, IdCard, Users } from 'lucide-react'
import { isAuthError, loaders } from '@/lib/loaders'
import { Avatar, EmptyState } from '@/components/ui'
import PeopleSearch from '@/components/leads/people-search'

const FILTERS = [
  { key: '', label: 'everyone' },
  { key: 'started', label: 'has a profile' },
  { key: 'reachable', label: 'reachable' },
  { key: 'none', label: 'no profile' },
] as const

/** Buckets over the follower count, matching reachTierOf on the backend. */
const TIERS = [
  { key: 'small', label: 'under 500', hint: 'Fewer than 500 followers on their widest account' },
  { key: 'mid', label: '500 – 5k', hint: '500 to 5,000 followers on their widest account' },
  { key: 'large', label: '5k+', hint: 'Over 5,000 followers on their widest account' },
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
  searchParams: Promise<{ q?: string; profile?: string; status?: string; lead?: string; audience?: string; tier?: string }>
}) {
  const params = await searchParams
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.profile) query.set('profile', params.profile)
  if (params.status) query.set('status', params.status)
  if (params.lead) query.set('lead', params.lead)
  if (params.audience) query.set('audience', params.audience)
  if (params.tier) query.set('tier', params.tier)

  const res = await loaders.getPeople(Object.fromEntries(query))
  if (isAuthError(res)) redirect('/sign-in')
  if (!res.success) throw new Error(res.error?.message ?? 'failed to load people')
  const people = res.data ?? []

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

      <div className="mb-2 flex flex-wrap gap-2">
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

      {/* A second row rather than more chips in the first: these narrow by a
          different property, and mixing them would imply they are alternatives
          to each other when they combine. */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>also</span>
        <Link
          href={href({ lead: params.lead === 'yes' ? '' : 'yes' })}
          className={`rounded-full border px-3 py-1 ${
            params.lead === 'yes'
              ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
              : 'border-zinc-300 dark:border-zinc-700'
          }`}
        >
          scores as a lead
        </Link>
        <Link
          href={href({ audience: params.audience === 'known' ? '' : 'known' })}
          className={`rounded-full border px-3 py-1 ${
            params.audience === 'known'
              ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
              : 'border-zinc-300 dark:border-zinc-700'
          }`}
          title="Only ~23% of accounts report a follower count, and almost all of those are on X — this narrows to the ones we know about rather than ranking everyone by it"
        >
          audience known
        </Link>
        {/* Tier buckets the follower count we DO have: small <500, mid <5k,
            large 5k+. They describe the quarter of accounts that report one —
            mostly X — so they narrow within "known" rather than partitioning
            everyone, and picking one implies audience known. */}
        {TIERS.map((t) => (
          <Link
            key={t.key}
            href={href({ tier: params.tier === t.key ? '' : t.key, audience: '' })}
            className={`rounded-full border px-3 py-1 ${
              params.tier === t.key
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-300 dark:border-zinc-700'
            }`}
            title={t.hint}
          >
            {t.label}
          </Link>
        ))}
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
          {people.map((p) => (
            <li
              key={p.documentId}
              className="rounded-lg border border-zinc-200 bg-white p-3 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
            >
              <div className="flex flex-wrap items-start gap-3">
                <Avatar name={p.displayName ?? p.handle ?? '?'} src={p.avatarUrl ?? undefined} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {/* Underlined at rest, not only on hover. This is the way
                        in to everything the person has said, and a link you
                        cannot see is a page nobody opens. */}
                    <Link
                      href={`/leads/${p.documentId}`}
                      className="font-medium underline decoration-zinc-300 underline-offset-2 hover:decoration-current dark:decoration-zinc-600"
                    >
                      {p.displayName ?? `@${p.handle}`}
                    </Link>
                    {/* Lead state, in words. `watch` is a real band but reads
                        as a verb; "possible lead" says what it means to someone
                        deciding whether to spend half an hour on this person. */}
                    {(p.leadScore ?? 0) > 0 && (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          p.leadBand === 'hot' || p.leadBand === 'warm'
                            ? 'border-emerald-400 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
                            : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'
                        }`}
                        title={`Intent score ${p.leadScore} (${p.leadBand}). Intent only — reach is never part of it.`}
                      >
                        {p.leadBand === 'hot' || p.leadBand === 'warm' ? 'lead' : 'possible lead'}
                        {p.direction === 'away-from-us' ? ' · leaving' : ''}
                      </span>
                    )}
                    {/* every presence, so the row reads as one human with N
                        accounts rather than whichever handle happened to win.
                        Skipped when the title IS the only handle — the fallback
                        renders "@dev" and repeating it reads as two accounts. */}
                    {((p.aliases ?? []).length > 1 || p.displayName
                      ? p.aliases ?? []
                      : []
                    ).map((a) => (
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
                    {/* The count IS the doorway: it is the number that makes
                        you curious, and it used to be the one thing on the row
                        you could not click. Goes to the person page, which
                        lists every one of them newest first. */}
                    <Link
                      href={`/leads/${p.documentId}`}
                      className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-700 hover:decoration-current dark:decoration-zinc-600 dark:hover:text-zinc-300"
                      title={`Read all ${p.mentionCount} — every mention this person has made`}
                    >
                      {p.mentionCount} {p.mentionCount === 1 ? 'mention' : 'mentions'}
                    </Link>
                    {p.lastSeenAt && <span>last seen {new Date(p.lastSeenAt).toLocaleDateString()}</span>}
                    {/* Audience, named with the account it is on — and honest
                        about not knowing. A follower count we were never given
                        is not an audience of zero: Reddit reports one for 2
                        accounts in 187, so "unknown" is the common case and
                        must not read as "small". */}
                    {typeof p.followers === 'number' ? (
                      <span title="Audience size, for context. Never part of the lead score.">
                        {p.followers.toLocaleString()} followers
                        {p.reachOn ? ` on ${p.reachOn}` : ''}
                      </span>
                    ) : (
                      <span className="text-zinc-400" title="This platform does not report follower counts">
                        reach unknown
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
