'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Spinner } from '@/components/ui'

/**
 * Search the directory by URL, not by local state.
 *
 * The result belongs in the address bar: "everyone at Acme with no email yet"
 * is a view worth sending to someone, and a filter that lives only in a
 * component cannot be shared, bookmarked or reloaded. Submitted rather than
 * typed-through, because this searches across every account and profile of
 * every person and a request per keystroke is not worth it here.
 */
export default function PeopleSearch({ initial }: { initial: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(initial)
  const [pending, startTransition] = useTransition()

  const submit = (next: string) => {
    const q = new URLSearchParams(params.toString())
    if (next.trim()) q.set('q', next.trim())
    else q.delete('q')
    const s = q.toString()
    startTransition(() => router.push(s ? `/people?${s}` : '/people'))
  }

  return (
    <form
      className="relative mb-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit(value)
      }}
    >
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          // clearing the box restores the full list without a second action —
          // an empty search box that still shows filtered results reads broken
          if (!e.target.value) submit('')
        }}
        placeholder="Name, handle, company or email…"
        aria-label="Search people"
        className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-10 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {pending && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          <Spinner size={14} />
        </span>
      )}
    </form>
  )
}
