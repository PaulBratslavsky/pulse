'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

/** Route-segment error boundary — a Strapi outage renders this instead of
 *  Next's raw production error screen. */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('[pulse] route error:', error)
  }, [error])
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center mt-8">
      <AlertTriangle className="mx-auto mb-4 text-amber-500" size={40} />
      <p className="text-lg font-medium mb-2">Pulse couldn&apos;t reach the backend</p>
      <p className="text-sm text-zinc-500 max-w-md mx-auto mb-6">
        The Strapi API didn&apos;t answer. It may be restarting or deploying — usually this clears in
        under a minute.
      </p>
      <button
        onClick={() => reset()}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
      >
        Try again
      </button>
    </div>
  )
}
