'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Lightbulb, RotateCcw, ScanSearch, VolumeX } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/ui/mutation-error'
import type { TMutedTopic, TMuteSuggestion } from '@/types'

const REASON_LABEL: Record<string, string> = {
  'not-a-competitor': 'not a competitor',
  'off-topic': 'off-topic',
  'too-noisy': 'too noisy',
  other: 'other',
}

/**
 * Muted topics: the noise filter.
 *
 * Deliberately different from muted authors, and the copy says so — muting a
 * topic does not hide anything from the team, it only takes it out of the
 * numbers. The suggestions block is the entry point most people will use; the
 * per-topic mute button lives on the Themes page, where the volume that
 * justifies muting is already on screen.
 */
export default function MutedTopics({
  muted,
  suggestions,
  windowDays,
}: {
  muted: TMutedTopic[]
  suggestions: TMuteSuggestion[]
  windowDays: number
}) {
  const router = useRouter()
  const [pendingSlug, setPendingSlug] = useState<string | null>(null)

  const mute = useMutation({
    mutationFn: (slug: string) => {
      setPendingSlug(slug)
      return pulseFetch('POST', 'muted-topics/mute', { slug, reason: 'not-a-competitor' })
    },
    onSettled: () => setPendingSlug(null),
    onSuccess: () => router.refresh(),
  })
  const remove = useMutation({
    mutationFn: (documentId: string) => pulseFetch('DELETE', `muted-topics/${documentId}/unmute`),
    onSuccess: () => router.refresh(),
  })
  const rescan = useMutation({
    mutationFn: () =>
      pulseFetch<{ data: { scanned: number; flagged: number; restored: number } }>(
        'POST',
        'muted-topics/rescan'
      ),
    onSuccess: () => router.refresh(),
  })

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <h2 className="font-medium mb-1 flex items-center gap-2">
        <VolumeX size={16} className="text-zinc-400" /> Muted topics
      </h2>
      <p className="text-sm text-zinc-500 mb-4">
        For terms we listen for that aren&apos;t really our competitors. A muted topic&apos;s
        mentions stay stored and readable in the monitor lane, but drop out of trends, themes, topic
        volumes and the Pulse score — and stop costing model calls. Leads are never muted, so this
        can&apos;t hide someone shopping for a CMS. Unmuting restores everything.
      </p>

      {suggestions.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-900 dark:text-amber-200">
            <Lightbulb size={14} /> Looks like noise — last {windowDays} days
          </p>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li
                key={s.topic.slug}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                data-testid="mute-suggestion"
              >
                <span className="font-medium">#{s.topic.name}</span>
                <span className="text-xs text-zinc-500">{s.reason}</span>
                <button
                  onClick={() => mute.mutate(s.topic.slug)}
                  disabled={mute.isPending}
                  className="ml-auto rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 max-sm:min-h-[38px] max-sm:px-3 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
                >
                  {pendingSlug === s.topic.slug ? 'Muting…' : 'Mute'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <MutationError m={mute} className="mb-3 text-xs" />

      <div className="mb-4 flex items-center">
        <button
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
          title="Reconcile the muted flag across history — the analysis sweep can attach a muted topic to an old mention long after it was muted"
        >
          <ScanSearch size={12} /> {rescan.isPending ? 'Scanning…' : 'Rescan history'}
        </button>
      </div>
      {rescan.data && (
        <p className="-mt-2 mb-4 text-xs text-zinc-500">
          Scanned {rescan.data.data.scanned} · {rescan.data.data.flagged} newly muted ·{' '}
          {rescan.data.data.restored} restored
        </p>
      )}
      <MutationError m={rescan} className="-mt-2 mb-4 text-xs" />

      {muted.length === 0 ? (
        <p className="text-sm text-zinc-500">No muted topics yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {muted.map((m) => (
            <li key={m.documentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="max-w-full truncate font-medium">#{m.topic?.name ?? m.slug}</span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {REASON_LABEL[m.reason] ?? m.reason}
              </span>
              <span className="text-xs text-zinc-500">
                {m.mentionCount ?? 0} mention{(m.mentionCount ?? 0) === 1 ? '' : 's'} out of the
                numbers
              </span>
              {m.note && <span className="max-w-full truncate text-xs text-zinc-400">{m.note}</span>}
              <button
                onClick={() => remove.mutate(m.documentId)}
                disabled={remove.isPending}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-400 max-sm:min-h-[38px] max-sm:px-3 dark:border-zinc-700 dark:text-zinc-400"
                title="Unmute — its mentions rejoin the metrics and the sweep analyzes them again"
              >
                <RotateCcw size={11} /> Unmute
              </button>
            </li>
          ))}
        </ul>
      )}
      <MutationError m={remove} className="mt-2 text-xs" />
    </div>
  )
}
