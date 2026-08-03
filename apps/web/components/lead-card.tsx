'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Quote, Users, MapPin, Building2, IdCard } from 'lucide-react'
import { Avatar } from '@/components/ui'
import LeadStatus from '@/components/lead-status'

const BAND_STYLE: Record<string, string> = {
  hot: 'border-red-400 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  warm: 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  watch: 'border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300',
  none: 'border-zinc-300 text-zinc-500 dark:border-zinc-700',
}

const DIRECTION_LABEL: Record<string, { text: string; className: string; title: string }> = {
  'toward-us': {
    text: 'toward us',
    className: 'border-emerald-400 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300',
    title: 'Considering or adopting Strapi',
  },
  'away-from-us': {
    text: 'leaving',
    className: 'border-red-400 text-red-700 dark:border-red-800 dark:text-red-300',
    title: 'Moving off Strapi. The intent is real — it just points the other way.',
  },
  open: {
    text: 'undecided',
    className: 'border-blue-400 text-blue-700 dark:border-blue-800 dark:text-blue-300',
    title: 'An active decision with no direction stated yet — the most winnable kind',
  },
}

export default function LeadCard({ lead }: { lead: any }) {
  const [open, setOpen] = useState(false)
  const ctx = lead.leadContext ?? {}
  const signals: { id: string; points: number; label: string }[] = ctx.signals ?? []
  const direction = DIRECTION_LABEL[lead.direction]

  return (
    // The card is a link to the person, but the controls inside it are not:
    // a nested <a> or <button> inside <Link> still fires its own handler, and
    // the status select stops propagation so changing it never navigates.
    <div className="relative rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      {/* Mouse affordance only. The real, announced link is the person's name
          below — a full-card overlay carrying the accessible name would be
          announced as a second identical link, and it cannot be reached by
          keyboard in any useful order. */}
      <Link
        href={`/leads/${lead.documentId}`}
        aria-hidden
        tabIndex={-1}
        className="absolute inset-0 z-0 rounded-lg"
      />
      <div className="relative z-10 flex flex-wrap items-start gap-3 pointer-events-none [&_a]:pointer-events-auto [&_select]:pointer-events-auto [&_button]:pointer-events-auto">
        <Avatar name={lead.displayName ?? lead.handle ?? '?'} src={lead.avatarUrl ?? undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/leads/${lead.documentId}`}
              className="font-medium hover:underline underline-offset-2"
            >
              {lead.displayName ?? `@${lead.handle}`}
            </Link>
            {lead.profileUrl && (
              <a
                href={lead.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 underline underline-offset-2"
              >
                @{lead.handle} <ExternalLink size={11} />
              </a>
            )}
            {lead.channel && <span className="text-xs text-zinc-400">{lead.channel}</span>}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span
              className={`rounded-full border px-2 py-0.5 font-medium ${BAND_STYLE[lead.leadBand] ?? BAND_STYLE.none}`}
              title="Intent only. Reach and other context are shown separately and never added into this number."
            >
              {lead.leadBand} · {lead.leadScore}
            </span>
            {direction && (
              <span className={`rounded-full border px-2 py-0.5 ${direction.className}`} title={direction.title}>
                {direction.text}
              </span>
            )}
            {/* reach sits BESIDE the score, never inside it — it is present on a
                third of leads and almost only on X, so scoring it would rank by
                which platform someone happens to post on */}
            <span
              className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-700"
              title="Audience size, shown for context only. Not part of the score."
            >
              <Users size={10} />
              {lead.reachTier === 'unknown'
                ? 'reach unknown'
                : `${lead.reachTier}${typeof lead.followers === 'number' ? ` · ${lead.followers.toLocaleString()}` : ''}`}
            </span>
            {/* someone is working this one. Worth a badge because it is the
                only state on the card a HUMAN created — and because a profiled
                lead stays on the board after its score decays away, which
                would otherwise look like a scoring bug. */}
            {lead.profile?.started && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-violet-300 px-2 py-0.5 text-violet-700 dark:border-violet-800 dark:text-violet-300"
                title={
                  lead.profile.hasEmail
                    ? 'A profile exists and there is an email to reach them'
                    : 'A profile exists, but no email yet — not reachable'
                }
              >
                <IdCard size={10} />
                {lead.profile.hasEmail ? 'reachable' : 'profile started'}
                {lead.profile.company ? ` · ${lead.profile.company}` : ''}
              </span>
            )}
            {ctx.ageDays != null && (
              <span className="text-zinc-400" title={`Decay applied: ×${ctx.decayApplied}`}>
                {ctx.ageDays === 0 ? 'today' : `${ctx.ageDays}d ago`}
              </span>
            )}
          </div>
        </div>

        <LeadStatus documentId={lead.documentId} status={lead.status} />
      </div>

      {/* The quote is the point of the card: it is what a human reads before
          reaching out, and the only proof the lead was grounded in the author's
          own words rather than inferred. */}
      {ctx.evidence ? (
        // raised above the card-wide link overlay so the quote stays
        // selectable: it is the sentence you paste into an outreach message,
        // and an overlay that eats text selection would make you open the
        // person page just to copy one line
        <blockquote className="relative z-10 mt-3 flex select-text gap-2 rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">
          <Quote size={14} className="mt-0.5 shrink-0 text-zinc-400" />
          <span className="min-w-0 break-words italic">{ctx.evidence}</span>
        </blockquote>
      ) : (
        <p className="mt-3 text-xs text-zinc-400">
          No quote recorded — classified before evidence was stored. Reclassify to capture one.
        </p>
      )}

      <div className="relative z-10 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 pointer-events-none [&_button]:pointer-events-auto">
        {ctx.competitor && (
          <span className="inline-flex items-center gap-1">
            <Building2 size={11} /> {ctx.competitor}
          </span>
        )}
        {ctx.venue && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={11} /> {ctx.venue}
          </span>
        )}
        {ctx.postKind && ctx.postKind !== 'unknown' && <span>{ctx.postKind}</span>}
        <span>
          {lead.mentionCount} {lead.mentionCount === 1 ? 'mention' : 'mentions'}
        </span>
        {lead.owner && <span>owner: {lead.owner.username}</span>}
        <button onClick={() => setOpen((v) => !v)} className="underline underline-offset-2">
          {open ? 'hide' : 'why this score'}
        </button>
      </div>

      {/* A score nobody can explain is a score nobody trusts. */}
      {open && (
        <ul className="relative z-10 mt-2 space-y-1 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
          {signals.map((s) => (
            <li key={s.id}>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">+{s.points}</span> {s.label}
            </li>
          ))}
          {ctx.decayApplied != null && ctx.decayApplied < 1 && (
            <li>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">×{ctx.decayApplied}</span> aged{' '}
              {ctx.ageDays} days — intent fades to zero at 90
            </li>
          )}
          <li className="pt-1 text-zinc-400">
            Reach and venue are shown for context and are deliberately not part of this number.
          </li>
        </ul>
      )}
    </div>
  )
}
