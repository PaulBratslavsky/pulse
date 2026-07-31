import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, Quote, Users } from 'lucide-react'
import { strapiFetch } from '@/lib/strapi'
import { Avatar, Disclosure } from '@/components/ui'
import { SentimentBadge, LaneBadge } from '@/components/badges'
import Timeline from '@/components/timeline'
import LeadStatus from '@/components/lead-status'

const BAND_STYLE: Record<string, string> = {
  hot: 'border-red-400 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  warm: 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  watch:
    'border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300',
}

/**
 * One person: everything they have said, why they scored, and the team's own
 * running notes. The lead card is a summary — this is the page you actually
 * read before reaching out.
 */
export default async function PersonPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params

  let data: any
  try {
    data = await strapiFetch(`/api/people/${documentId}`)
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    if (err.status === 404) notFound()
    throw err
  }
  const p = data.data
  if (!p) notFound()

  const me = await strapiFetch('/api/users/me').catch(() => null)
  const ctx = p.leadContext ?? {}
  const signals: { id: string; points: number; label: string }[] = ctx.signals ?? []
  const mentions: any[] = p.mentions ?? []

  return (
    <div>
      <Link
        href="/leads"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <ArrowLeft size={14} /> Leads
      </Link>

      {/* A CONTAINER query, not a viewport one. This page renders between the
          app's left nav and right rail, so at a 1280px viewport the content
          area is only ~630px — a viewport-keyed `xl:` split fired there and
          gave the sidebar more room than the conversation. Splitting on the
          container's own width means it only goes two-up when two columns
          genuinely fit. */}
      <div className="@container">
        <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="min-w-0">
          {/* The avatar is its own column so BOTH rows share one left edge —
              previously the name sat beside the avatar while the meta line
              started underneath it, so the two rows stepped in and out. */}
          <header className="mb-6 flex items-start gap-4">
            <Avatar name={p.displayName ?? p.handle ?? '?'} src={p.avatarUrl} size="xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h1 className="min-w-0 flex-1 basis-48 truncate text-2xl font-semibold leading-tight">
                  {p.displayName ?? `@${p.handle}`}
                </h1>
                {/* the control alone on the top row, flush right; who owns it
                    is a fact, so it belongs with the other facts below */}
                <span className="ml-auto shrink-0">
                  <LeadStatus documentId={p.documentId} status={p.status} />
                </span>
              </div>
              {/* text-xs, not text-sm: at 14px the five facts wrapped onto a
                  second line and the header lost its shape. These are
                  reference details, not something to read at body size. */}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                {p.profileUrl ? (
                  <a
                    href={p.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-2"
                  >
                    @{p.handle} <ExternalLink size={12} />
                  </a>
                ) : (
                  <span>@{p.handle}</span>
                )}
                {p.channel?.name && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{p.channel.name}</span>
                  </>
                )}
                <span aria-hidden>·</span>
                <span>
                  {p.mentionCount} {p.mentionCount === 1 ? 'mention' : 'mentions'}
                </span>
                {p.firstSeenAt && (
                  <>
                    <span aria-hidden>·</span>
                    <span>since {new Date(p.firstSeenAt).toLocaleDateString()}</span>
                  </>
                )}
                {p.owner && (
                  <>
                    <span aria-hidden>·</span>
                    <span>owned by {p.owner.username}</span>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* the quote that justified the lead, verified verbatim against the post */}
          {ctx.evidence && (
            <blockquote className="mb-5 flex gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <Quote size={16} className="mt-0.5 shrink-0 text-zinc-400" />
              <span className="min-w-0 break-words italic">{ctx.evidence}</span>
            </blockquote>
          )}

          <h2 className="mb-3 font-medium">
            Conversation history
            <span className="ml-2 text-sm font-normal text-zinc-500">
              everything they have posted that we captured
            </span>
          </h2>
          {mentions.length === 0 ? (
            <p className="text-sm text-zinc-500">No mentions on file.</p>
          ) : (
            <ol className="mb-8 space-y-3">
              {mentions.map((m) => (
                <li
                  key={m.documentId}
                  className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <SentimentBadge label={m.sentimentLabel} />
                    <LaneBadge lane={m.lane} reason={m.laneReason} />
                    {m.venue && <span>{m.venue}</span>}
                    {m.postKind && m.postKind !== 'unknown' && <span>{m.postKind}</span>}
                    <span>
                      {m.postedAt ? new Date(m.postedAt).toLocaleString() : '—'}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {m.content}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <Link
                      href={`/mentions/${m.documentId}`}
                      className="text-zinc-500 underline underline-offset-2"
                    >
                      open mention
                    </Link>
                    {m.url && (
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-zinc-500 underline underline-offset-2"
                      >
                        original <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <aside className="space-y-4">
          {/* Collapsed by default, but the score itself stays visible — the
              number is the answer, the breakdown is only needed when you doubt
              it. Same for Context: three facts should not cost half a screen. */}
          <Disclosure
            title="Why this score"
            summaryRight={
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${BAND_STYLE[p.leadBand] ?? 'border-zinc-300 text-zinc-500 dark:border-zinc-700'}`}
              >
                {p.leadBand} · {p.leadScore}
              </span>
            }
          >
            {ctx.direction && ctx.direction !== 'none' && (
              <p className="mb-2 text-xs text-zinc-500">direction: {ctx.direction}</p>
            )}
            <ul className="space-y-1 text-xs text-zinc-500">
              {signals.map((s) => (
                <li key={s.id}>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">+{s.points}</span>{' '}
                  {s.label}
                </li>
              ))}
              {ctx.decayApplied != null && ctx.decayApplied < 1 && (
                <li>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    ×{ctx.decayApplied}
                  </span>{' '}
                  aged {ctx.ageDays} days — intent fades to zero at 90
                </li>
              )}
              <li className="pt-1 text-zinc-400">
                Reach and venue are shown separately and are deliberately not part of this number.
              </li>
            </ul>
          </Disclosure>

          <Disclosure
            title="Context"
            summaryRight={
              <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                <Users size={11} />
                {p.reachTier === 'unknown' ? 'reach unknown' : p.reachTier}
              </span>
            }
          >
            <p className="mb-3 text-xs text-zinc-500">
              Shown for your judgement — none of it is part of the score.
            </p>
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-xs text-zinc-500">Reach</dt>
                <dd className="text-right">
                  {p.reachTier === 'unknown'
                    ? `not available on ${p.channel?.key ?? 'this platform'}`
                    : `${p.reachTier}${typeof p.followers === 'number' ? ` · ${p.followers.toLocaleString()}` : ''}`}
                </dd>
              </div>
              {ctx.competitor && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-zinc-500">Competitor</dt>
                  <dd>{ctx.competitor}</dd>
                </div>
              )}
              {ctx.venue && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-zinc-500">Venue</dt>
                  <dd>{ctx.venue}</dd>
                </div>
              )}
              {ctx.postKind && ctx.postKind !== 'unknown' && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-zinc-500">Post type</dt>
                  <dd>{ctx.postKind}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-xs text-zinc-500">Identity</dt>
                <dd
                  className="truncate text-right text-xs"
                  title={`${p.identityKey}${p.identityProvisional ? ' (provisional — no profile URL)' : ''}`}
                >
                  {p.identityKey}
                </dd>
              </div>
            </dl>
          </Disclosure>

          {/* Notes sit beside the conversation rather than under it: you write
              one while reading what they said, not after scrolling past it. */}
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <Timeline
              mention={p}
              subject="person"
              title="Notes & activity"
              meDocumentId={me?.documentId}
            />
          </div>
        </aside>
      </div>
      </div>
    </div>
  )
}
