'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { ExternalLink, Quote, Users, MapPin, Building2 } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'
import { Spinner, Avatar } from '@/components/ui'

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

const STATUSES = ['new', 'watching', 'contacted', 'qualified', 'not-a-fit'] as const

export default function LeadCard({ lead }: { lead: any }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const ctx = lead.leadContext ?? {}
  const signals: { id: string; points: number; label: string }[] = ctx.signals ?? []
  const direction = DIRECTION_LABEL[lead.direction]

  const setStatus = useMutation({
    mutationFn: (status: string) => pulseFetch('POST', `people/${lead.documentId}/status`, { status }),
    onSuccess: () => router.refresh(),
  })

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar name={lead.displayName ?? lead.handle ?? '?'} src={lead.avatarUrl ?? undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{lead.displayName ?? `@${lead.handle}`}</span>
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
            {ctx.ageDays != null && (
              <span className="text-zinc-400" title={`Decay applied: ×${ctx.decayApplied}`}>
                {ctx.ageDays === 0 ? 'today' : `${ctx.ageDays}d ago`}
              </span>
            )}
          </div>
        </div>

        <select
          value={lead.status}
          onChange={(e) => setStatus.mutate(e.target.value)}
          disabled={setStatus.isPending}
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {setStatus.isPending && <Spinner size={14} />}
      </div>

      {/* The quote is the point of the card: it is what a human reads before
          reaching out, and the only proof the lead was grounded in the author's
          own words rather than inferred. */}
      {ctx.evidence ? (
        <blockquote className="mt-3 flex gap-2 rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">
          <Quote size={14} className="mt-0.5 shrink-0 text-zinc-400" />
          <span className="min-w-0 break-words italic">{ctx.evidence}</span>
        </blockquote>
      ) : (
        <p className="mt-3 text-xs text-zinc-400">
          No quote recorded — classified before evidence was stored. Reclassify to capture one.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
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
        <ul className="mt-2 space-y-1 border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
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

      <MutationError m={setStatus} className="mt-2 text-xs" />
    </div>
  )
}
