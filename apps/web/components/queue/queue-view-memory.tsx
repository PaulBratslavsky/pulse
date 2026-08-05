'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

/**
 * Remember which queue you were looking at.
 *
 * The filters live in the URL, which is right — a filtered queue is a view
 * worth sending to someone. But every route back to the queue dropped it: the
 * nav link is a bare "/", and a mention page had no way back at all. Triaging
 * is open-read-return, dozens of times, and re-picking four filters after each
 * one is the kind of friction that makes people stop filtering.
 *
 * sessionStorage, not localStorage, and the distinction matters: this is "where
 * I was", not "how I like things". Per tab, gone when the tab closes. Stored in
 * localStorage, a spam filter set once would silently narrow the queue next
 * week, and the empty result would look like a bug rather than a filter.
 */
const KEY = 'pulse-queue-view'

/** Rendered by the queue page. Records the current query for the trip back. */
export function RememberQueueView({ search }: { search: string }) {
  useEffect(() => {
    try {
      if (search) sessionStorage.setItem(KEY, search)
      else sessionStorage.removeItem(KEY)
    } catch {
      /* private mode — the queue still works, it just forgets */
    }
  }, [search])
  return null
}

function useRememberedQueue() {
  // Empty on the server and on first paint, so the markup matches and the href
  // upgrades once we know. A link that renders "/" and then improves is fine;
  // one that mismatches during hydration is not.
  const [search, setSearch] = useState('')
  useEffect(() => {
    try {
      setSearch(sessionStorage.getItem(KEY) ?? '')
    } catch {
      /* ignore */
    }
  }, [])
  return search
}

/** The way back from a mention, to the queue you actually came from. */
export function BackToQueue() {
  const search = useRememberedQueue()
  return (
    <Link
      href={`/${search}`}
      className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
    >
      <ArrowLeft size={14} />
      {search ? 'Back to your filtered queue' : 'Back to the queue'}
    </Link>
  )
}

/** The nav's Queue link, which should also land where you left off. */
export function QueueNavHref({ children }: { children: (href: string) => React.ReactNode }) {
  return <>{children(`/${useRememberedQueue()}`)}</>
}
