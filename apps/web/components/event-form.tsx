'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { CalendarPlus } from 'lucide-react'
import { pulseFetch } from '@/lib/pulse-client'
import { MutationError } from '@/components/mutation-error'

/**
 * Annotate the trend line with a release / launch / incident.
 *
 * This is the one CRUD surface Pulse duplicates from the admin panel, and
 * deliberately: the moment you realise an annotation is needed is while
 * looking at the chart thinking "that dip was v5.51". Sending someone to
 * another app loses the context that made it worth writing. Editing and
 * deleting stay in admin — this captures the moment, it isn't a manager.
 */
export default function EventForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  // defaults to today, the overwhelmingly common case
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [kind, setKind] = useState('release')
  const [notes, setNotes] = useState('')

  const create = useMutation({
    mutationFn: () => pulseFetch('POST', 'events', { title, date, kind, notes: notes || undefined }),
    onSuccess: () => {
      setTitle('')
      setNotes('')
      setOpen(false)
      router.refresh()
    },
  })

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <CalendarPlus size={14} /> Add event
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-3 text-sm font-medium">Annotate the timeline</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[14rem] text-xs text-zinc-500">
          What happened
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) create.mutate()
              if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="v5.52 release"
            autoFocus
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <label className="text-xs text-zinc-500">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 block rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <label className="text-xs text-zinc-500">
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 block rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="release">release</option>
            <option value="launch">launch</option>
            <option value="incident">incident</option>
          </select>
        </label>
      </div>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional) — what to remember when reading this spike later"
        className="mt-3 block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => create.mutate()}
          disabled={!title.trim() || create.isPending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {create.isPending ? 'Adding…' : 'Add event'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
        >
          Cancel
        </button>
        <MutationError m={create} className="text-xs" />
      </div>
    </div>
  )
}
