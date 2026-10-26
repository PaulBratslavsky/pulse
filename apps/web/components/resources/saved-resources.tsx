'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, BookOpen, Check, Copy, Eye, EyeOff, Pin, PinOff, RefreshCw, Search, Trash2 } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { EmptyState } from '@/components/ui'
import { MutationError } from '@/components/ui/mutation-error'
import type { TResource } from '@/types'
import SharedBefore from './shared-before'

/**
 * The team's saved resources.
 *
 * Filtered on the client: the list is small by design (a curated subset, not
 * the blog), so a keystroke filter beats a round trip. Hidden resources come
 * down too and are only shown on request — hiding is "stop suggesting this",
 * not "delete it", and you need to be able to find one again to un-hide it.
 */
export default function SavedResources({ resources }: { resources: TResource[] }) {
  const router = useRouter()
  const [filter, setFilter] = useState('')
  const [showHidden, setShowHidden] = useState(false)

  const hiddenCount = resources.filter((r) => r.hidden).length
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return resources.filter((r) => {
      if (r.hidden && !showHidden) return false
      if (!needle) return true
      return [r.title, r.summary, r.note, r.category, ...(r.keywords ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    })
  }, [resources, filter, showHidden])

  const refresh = useMutation({
    mutationFn: () => pulseFetch('POST', 'resources/refresh'),
    // the refresh runs in the background; give it a moment before re-reading
    onSuccess: () => setTimeout(() => router.refresh(), 2500),
  })

  if (resources.length === 0) {
    return (
      <>
      <SharedBefore />
      <EmptyState icon={<BookOpen size={28} className="mx-auto mb-3 text-zinc-300" />} title="Nothing saved yet">
        <p className="text-sm text-zinc-500">
          <Link href="/resources?view=find" className="font-medium text-blue-600 hover:underline">
            Find a post on the blog
          </Link>{' '}
          and save it. Saved posts are the ones Pulse suggests when you reply.
        </p>
      </EmptyState>
      </>
    )
  }

  return (
    <div>
      <SharedBefore />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter saved resources…"
            aria-label="Filter saved resources"
            className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        {hiddenCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Show hidden ({hiddenCount})
          </label>
        )}
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 max-sm:min-h-[38px] dark:border-zinc-700 dark:text-zinc-400"
          title="Re-read every saved post from the marketing site — picks up edits and flags posts that were unpublished. Also runs nightly."
        >
          <RefreshCw size={12} className={refresh.isPending ? 'animate-spin' : ''} />
          {refresh.isPending ? 'Starting…' : 'Refresh from blog'}
        </button>
      </div>
      {refresh.isSuccess && (
        <p className="-mt-1 mb-3 text-xs text-zinc-500">Refresh started — edits on the blog show up here in a moment.</p>
      )}
      <MutationError m={refresh} className="mb-3 text-xs" />

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">
          {filter.trim()
            ? `No saved resources match “${filter.trim()}”.`
            : 'Every saved resource is hidden — tick “Show hidden” to see them.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => (
            <ResourceRow key={r.documentId} resource={r} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ResourceRow({ resource: r }: { resource: TResource }) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(r.note ?? '')

  const patch = useMutation({
    mutationFn: (data: { pinned?: boolean; hidden?: boolean; note?: string | null }) =>
      pulseFetch('PUT', `resources/${r.documentId}`, data),
    onSuccess: () => {
      setEditing(false)
      router.refresh()
    },
  })
  const remove = useMutation({
    mutationFn: () => pulseFetch('DELETE', `resources/${r.documentId}`),
    onSuccess: () => router.refresh(),
  })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the link itself is still right there */
    }
  }

  const btn =
    'inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-zinc-400 disabled:opacity-50 max-sm:min-h-[38px] max-sm:px-3 dark:border-zinc-700 dark:text-zinc-400'

  return (
    <li
      data-testid="saved-resource"
      className={`rounded-lg border bg-white p-4 dark:bg-zinc-900 ${
        r.pinned ? 'border-[#7B79FF]/60' : 'border-zinc-200 dark:border-zinc-800'
      } ${r.hidden ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <a
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 basis-64 font-medium text-blue-600 hover:underline [overflow-wrap:anywhere]"
        >
          {r.title} ↗
        </a>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.pinned && (
            <span className="inline-flex items-center gap-1 rounded bg-[#4945FF]/10 px-1.5 py-0.5 text-xs font-medium text-[#4945FF] dark:text-[#9D9BFF]">
              <Pin size={10} /> Pinned
            </span>
          )}
          {r.hidden && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">Hidden</span>
          )}
          {r.upstreamMissing && (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
              title="This post is no longer published on the marketing site. The link may 404 — check before sending it."
            >
              <AlertTriangle size={10} /> Unpublished on the blog
            </span>
          )}
        </div>
      </div>

      <p className="mt-0.5 text-xs text-zinc-500">
        {[r.category, r.version && r.version !== 'v5' && `written for ${r.version}`, r.postedAt && new Date(r.postedAt).toLocaleDateString(), r.savedBy?.username && `saved by ${r.savedBy.username}`]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {r.summary && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{r.summary}</p>}

      {editing ? (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            patch.mutate({ note: note.trim() || null })
          }}
        >
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="When is this the right link? e.g. webhook signature questions"
            aria-label="Note"
            className="min-w-0 flex-1 basis-64 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button type="submit" disabled={patch.isPending} className={btn}>
            Save note
          </button>
          <button
            type="button"
            onClick={() => {
              setNote(r.note ?? '')
              setEditing(false)
            }}
            className={btn}
          >
            Cancel
          </button>
        </form>
      ) : (
        r.note && (
          <p className="mt-2 rounded bg-zinc-50 px-2 py-1 text-sm text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
            {r.note}
          </p>
        )
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button onClick={copy} className={btn}>
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy link'}
        </button>
        <button onClick={() => patch.mutate({ pinned: !r.pinned })} disabled={patch.isPending} className={btn}>
          {r.pinned ? <PinOff size={11} /> : <Pin size={11} />} {r.pinned ? 'Unpin' : 'Pin'}
        </button>
        {!editing && (
          <button onClick={() => setEditing(true)} className={btn}>
            {r.note ? 'Edit note' : 'Add note'}
          </button>
        )}
        <button
          onClick={() => patch.mutate({ hidden: !r.hidden })}
          disabled={patch.isPending}
          className={btn}
          title={r.hidden ? 'Suggest this again' : 'Stop suggesting this, without losing it'}
        >
          {r.hidden ? <Eye size={11} /> : <EyeOff size={11} />} {r.hidden ? 'Unhide' : 'Hide'}
        </button>
        <button
          onClick={() => {
            if (confirm(`Remove “${r.title}” from saved resources?`)) remove.mutate()
          }}
          disabled={remove.isPending}
          className={`${btn} ml-auto hover:border-red-300 hover:text-red-600`}
        >
          <Trash2 size={11} /> Remove
        </button>
      </div>
      <MutationError m={patch} className="mt-2 text-xs" />
      <MutationError m={remove} className="mt-2 text-xs" />
    </li>
  )
}
